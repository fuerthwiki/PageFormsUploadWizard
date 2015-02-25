/**
* Object that reperesents the entire multi-step Upload Wizard
*/

( function ( mw, uw, $ ) {

	mw.UploadWizard = function ( config ) {
		this.uploads = [];
		this.api = new mw.Api( { ajax: { timeout: 0 } } );

		// making a sort of global for now, should be done by passing in config or fragments of config when needed
		// elsewhere
		mw.UploadWizard.config = config;
		// Shortcut for local references
		this.config = config;

		var maxSimPref = mw.user.options.get( 'upwiz_maxsimultaneous' ),
			wizard = this;

		function finalizeDetails() {
			if ( wizard.allowCloseWindow !== undefined ) {
				wizard.allowCloseWindow();
			}
			wizard.moveToStep( 'thanks' );
		}

		if ( maxSimPref !== 'default' ) {
			if ( maxSimPref > 0 ) {
				config.maxSimultaneousConnections = maxSimPref;
			} else {
				config.maxSimultaneousConnections = 1;
			}
		}

		this.maxSimultaneousConnections = config.maxSimultaneousConnections;

		this.showDeed = false;

		this.steps = {
			tutorial: new uw.controller.Tutorial( this.api )
				.on( 'next-step', function () {
					wizard.moveToStep( 'file' );
				} ),
			file: new uw.controller.Upload( config )
				.on( 'retry', function () {
					uw.eventFlowLogger.logEvent( 'retry-uploads-button-clicked' );
					wizard.startUploads();
				} )

				.on( 'flickr-ui-init', function () {
					wizard.flickrInterfaceInit();
					uw.eventFlowLogger.logEvent( 'flickr-upload-button-clicked' );
				} )

				.on( 'next-step', function () {
					wizard.removeErrorUploads();

					if ( wizard.showDeed ) {
						wizard.moveToStep( 'deeds' );
					} else {
						wizard.moveToStep( 'details' );
					}
				} )

				.on( 'reset', function () {
					wizard.bailAndMoveToFile();
				} ),

			deeds: new uw.controller.Deed( this.api, config )
				.on( 'next-step', function () {
					wizard.moveToStep( 'details' );
				} )

				.on( 'no-uploads', function () {
					wizard.bailAndMoveToFile();
				} ),

			details: new uw.controller.Details( config )
				.on( 'start-details', function () {
					wizard.detailsSubmit().done( function () {
						wizard.detailsErrorCount();
						wizard.showNext( 'details', 'complete', finalizeDetails );
					} );
				} )

				.on( 'details-error', function () {
					wizard.detailsErrorCount();
				} )

				.on( 'finalize-details-after-removal', function () {
					wizard.removeErrorUploads();
					finalizeDetails();
				} )

				.on( 'no-uploads', function () {
					wizard.bailAndMoveToFile();
				} ),

			thanks: new uw.controller.Thanks()
		};

		if ( mw.UploadWizard.config.enableFirefogg && mw.Firefogg.isInstalled() ) {
			// update the "valid" extension to include firefogg transcode extensions:
			mw.UploadWizard.config.fileExtensions = $.merge(
				mw.UploadWizard.config.fileExtensions,
				mw.UploadWizard.config.transcodeExtensionList
			);
		}
	};

	mw.UploadWizard.DEBUG = true;

	mw.UploadWizard.userAgent = 'UploadWizard';

	mw.UploadWizard.prototype = {
		stepNames: [ 'tutorial', 'file', 'deeds', 'details', 'thanks' ],
		currentStepName: undefined,

		/**
		 * Reset the entire interface so we can upload more stuff
		 * (depends on updateFileCounts to reset the interface when uploads go down to 0)
		 * Depending on whether we split uploading / detailing, it may actually always be as simple as loading a URL
		 */
		reset: function () {
			mw.UploadWizardUpload.prototype.count = -1; // this is counterintuitive, but the count needs to start at -1 to allow for the empty upload created on the first step.
			this.showDeed = false;
			$.purgeReadyEvents();
			$.purgeSubscriptions();
			this.removeMatchingUploads( function () { return true; } );
			this.moveToStep( 'file' );
		},

		/**
		 * Resets wizard state and moves to the file step.
		 */
		bailAndMoveToFile: function () {
			// destroy the flickr interface if it exists
			this.flickrInterfaceDestroy();

			// fix various other pages that may have state
			$.each( this.steps, function ( i, step ) {
				step.empty();
			} );

			// remove any blocks on closing the window
			if ( this.allowCloseWindow !== undefined ) {
				this.allowCloseWindow();
			}

			this.moveToStep( 'file' );
		},

		/**
		 * create the basic interface to make an upload in this div
		 */
		createInterface: function () {
			var wizard = this;

			this.ui = new uw.ui.Wizard( this )
				.on( 'reset-wizard', function () {
					wizard.reset();
				} );

			// check to see if the the skip tutorial preference or global setting is set
			if (
				mw.user.options.get( 'upwiz_skiptutorial' ) ||
				( mw.config.get( 'UploadWizardConfig' ).tutorial && mw.config.get( 'UploadWizardConfig' ).tutorial.skip )
			) {
				// "select" the second step - highlight, make it visible, hide all others
				this.moveToStep( 'file' );
			} else {
				// "select" the first step - highlight, make it visible, hide all others
				this.moveToStep( 'tutorial' );
				( new mw.UploadWizardTutorialEvent( 'load' ) ).dispatch();
			}
		},

		/**
		 * Initiates the Interface to upload media from Flickr.
		 * Called when the user clicks on the 'Add images from Flickr' button.
		 */
		flickrInterfaceInit: function () {
			var $disclaimer,
				wizard = this,
				checker = new mw.FlickrChecker( this, this.upload ),
				// The input that will hold a flickr URL entered by the user; will be appended to a form
				$flickrInput = $( '<input id="mwe-upwiz-flickr-input" class="ui-helper-center-fix" type="text" />' ),
				// A container holding a form
				$flickrContainer = $( '<div id="mwe-upwiz-upload-add-flickr-container"></div>' ),
				// Form whose submit event will be listened to and prevented
				$flickrForm = $( '<form id="mwe-upwiz-flickr-url-form"></form>' )
					.appendTo( $flickrContainer ),
				// Submit button to be clicked after entering the URL
				$flickrButton = $( '<button id="mwe-upwiz-upload-add-flickr" class="ui-helper-center-fix" type="submit"></button>' )
					.appendTo( $flickrForm );

			// Hide containers for selecting files
			$( '#mwe-upwiz-add-file-container, #mwe-upwiz-upload-ctrl-flickr-container' ).hide();

			// Add placeholder text to the Flickr URL input field
			$flickrInput.placeholder( mw.message( 'mwe-upwiz-flickr-input-placeholder' ).escaped() );

			// Insert form into the page
			$( '#mwe-upwiz-files' ).prepend( $flickrContainer );

			// Add disclaimer
			$disclaimer = mw.message( 'mwe-upwiz-flickr-disclaimer1' ).parse() +
				'<br/>' + mw.message( 'mwe-upwiz-flickr-disclaimer2' ).parse();
			$disclaimer = $( '<div id="mwe-upwiz-flickr-disclaimer"></div>' ).html( $disclaimer );
			$( '#mwe-upwiz-upload-add-flickr-container' ).append( $disclaimer );

			// Insert input field into the form and set up submit action
			$flickrForm.prepend( $flickrInput ).submit( function () {
				$flickrButton.prop( 'disabled', true );
				wizard.flickrChecker( checker );
				// TODO Any particular reason to stopPropagation ?
				return false;
			} );

			// Set up the submit button
			$flickrButton.button( { label: mw.message( 'mwe-upwiz-add-flickr' ).escaped() } );

			$flickrInput.focus();
		},

		/**
		 * Responsible for fetching license of the provided media.
		 */
		flickrChecker: function ( checker ) {
			var flickrInputUrl = $( '#mwe-upwiz-flickr-input' ).val();
			checker.getLicenses();
			$( '#mwe-upwiz-flickr-select-list-container' ).bind( 'licenselistfilled', function () {
				checker.checkFlickr( flickrInputUrl );
			} );
		},

		/**
		 * Reset the interface if there is a problem while fetching the images from the URL entered by the user.
		 */
		flickrInterfaceReset: function () {
			// first destroy it completely, then reshow the add button
			this.flickrInterfaceDestroy();
			$( '#mwe-upwiz-upload-add-flickr-container' ).show();
			$( '#mwe-upwiz-upload-add-flickr' ).prop( 'disabled', false );
		},

		/**
		 * Removes the flickr interface.
		 */
		flickrInterfaceDestroy: function () {
			$( '#mwe-upwiz-flickr-input' ).val( '' );
			$( '#mwe-upwiz-flickr-select-list' ).empty();
			$( '#mwe-upwiz-flickr-select-list-container' ).unbind();
			$( '#mwe-upwiz-select-flickr' ).unbind();
			$( '#mwe-upwiz-flickr-select-list-container' ).hide();
			$( '#mwe-upwiz-upload-add-flickr-container' ).hide();
			$( '#mwe-upwiz-upload-add-flickr' ).prop( 'disabled', true );
		},

		/**
		 * Advance one "step" in the wizard interface.
		 * It is assumed that the previous step to the current one was selected.
		 * We do not hide the tabs because this messes up certain calculations we'd like to make about dimensions, while elements are not
		 * on screen. So instead we make the tabs zero height and, in CSS, they are already overflow hidden
		 * @param selectedStepName
		 * @param callback to do after layout is ready?
		 */
		moveToStep: function ( selectedStepName, callback ) {
			if ( this.currentStepName === selectedStepName ) {
				// already there!
				return;
			}

			// scroll to the top of the page (the current step might have been very long, vertically)
			var headScroll = $( 'h1:first' ).offset(),
				fromStep = this.steps[this.currentStepName],
				targetStep = this.steps[selectedStepName];

			if ( fromStep ) {
				fromStep.moveFrom( this.uploads );
			}

			targetStep.moveTo( this.uploads );

			$( 'html, body' ).animate( { scrollTop: headScroll.top, scrollLeft: headScroll.left }, 'slow' );

			if (
				selectedStepName === 'file' &&
				( !this.currentStepName || this.currentStepName === 'thanks' )
			) { // tutorial was skipped
				uw.eventFlowLogger.logSkippedStep( 'tutorial' );
			}

			uw.eventFlowLogger.logStep( selectedStepName );

			this.currentStepName = selectedStepName;

			if ( selectedStepName === 'file' ) {
				this.resetFileStepUploads();
			}

			$.each( this.uploads, function (i, upload) {
				if ( upload === undefined ) {
					return;
				}
				upload.state = selectedStepName;
			} );

			this.currentStepObject = targetStep;

			this.currentStepObject.updateFileCounts( this.uploads );

			if ( callback ) {
				callback();
			}
		},

		/**
		 * If there are no uploads, make a new one
		 */
		resetFileStepUploads: function () {
			if ( this.uploads.length === 0 ) {
				// add one upload field to start (this is the big one that asks you to upload something)
				this.newUpload();
				// hide flickr uploading button if user doesn't have permissions
				if ( !mw.UploadWizard.config.UploadFromUrl || mw.UploadWizard.config.flickrApiKey === '' ) {
					$( '#mwe-upwiz-upload-ctrl-flickr-container, #mwe-upwiz-flickr-select-list-container' ).hide();
				}
			}
		},

		/**
		 * Add an Upload
		 *   we create the upload interface, a handler to transport it to the server,
		 *   and UI for the upload itself and the "details" at the second step of the wizard.
		 *   we don't yet add it to the list of uploads; that only happens when it gets a real file.
		 *
		 * @return the new upload
		 */
		newUpload: function () {
			var upload,
				wizard = this;

			if ( this.uploads.length >= this.config.maxUploads ) {
				return false;
			}

			upload = new mw.UploadWizardUpload( this, '#mwe-upwiz-filelist' )
				.on( 'file-changed', function ( upload, files ) {
					var totalFiles = files.length + wizard.uploads.length,
						tooManyFiles = totalFiles > wizard.config.maxUploads;

					if ( tooManyFiles ) {
						wizard.steps.file.showTooManyFilesWarning( totalFiles );
						upload.resetFileInput();
						return;
					}

					upload.checkFile(
						upload.ui.getFilename(),
						files,
						function () { upload.fileChangedOk(); }
					);

					uw.eventFlowLogger.logUploadEvent( 'uploads-added', { quantity: files.length } );
				} )

				.on( 'starting', function () {
					wizard.steps.file.maybeStartProgressBar();

					wizard.allowCloseWindow = mw.confirmCloseWindow( {
						message: function () { return mw.message( 'mwe-upwiz-prevent-close', wizard.uploads.length ).escaped(); },
						test: function () { return !wizard.isComplete() && wizard.uploads.length > 0; },
						namespace: 'uploadwizard'
					} );
				} )

				.on( 'filled', function () {
					wizard.setUploadFilled( upload );
				} )

				.on( 'extra-files', function ( files, toobig ) {
					$.each( files, function ( i, file ) {
						// NOTE: By running newUpload we will end up calling checkfile() again.
						var newUpload = wizard.newUpload();

						if ( toobig ) {
							newUpload.disablePreview();
						}

						newUpload.fill( file );
					} );

					// Add a new upload to cover the button
					wizard.newUpload();

					wizard.currentStepObject.updateFileCounts( wizard.uploads );
				} )

				.on( 'filename-accepted', function () {
					wizard.currentStepObject.updateFileCounts( wizard.uploads );
				} )

				.on( 'error', function ( code, message ) {
					uw.eventFlowLogger.logError( 'file', { code: code, message: message } );
				} );

			// we explicitly move the file input to cover the upload button
			upload.ui.moveFileInputToCover( '#mwe-upwiz-add-file', 'poll' );

			upload.connect( this, {
				'remove-upload': [ 'removeUpload', upload ]
			} );

			return upload;
		},

		/**
		 * When an upload is filled with a real file, accept it in the wizard's list of uploads
		 * and set up some other interfaces
		 * @param UploadWizardUpload
		 */
		setUploadFilled: function ( upload ) {
			var wizard = this;

			this.uploads.push( upload );

			//If upload is through a local file, then we need to show the Deeds step of the wizard
			if ( !upload.fromURL ) {
				this.showDeed = true;
			}

			this.currentStepObject.updateFileCounts( this.uploads );

			// Start uploads now, no reason to wait--leave the remove button alone
			this.steps.file.transitionAll().done( function () {
				wizard.showNext( 'file', 'stashed' );
			} );
		},

		/**
		 * Remove an upload from our array of uploads, and the HTML UI
		 * We can remove the HTML UI directly, as jquery will just get the parent.
			 * We need to grep through the array of uploads, since we don't know the current index.
		 * We need to update file counts for obvious reasons.
		 *
		 * @param upload
		 */
		removeUpload: function ( upload ) {
			// remove the div that passed along the trigger
			var $div = $( upload.ui.div );

			$div.unbind(); // everything
			$div.remove();
			// and do what we in the wizard need to do after an upload is removed
			this.uploads = $.grep(
				this.uploads,
				function ( u ) {
					return u !== upload;
				}
			);

			this.currentStepObject.updateFileCounts( this.uploads );

			if ( this.uploads && this.uploads.length !== 0 ) {
				// check all uploads, if they're complete, show the next button
				this.showNext( 'file', 'stashed' );
			}
		},

		/**
		 * This is useful to clean out unused upload file inputs if the user hits GO.
		 * We are using a second array to iterate, because we will be splicing the main one, _this.uploads
		 */
		removeEmptyUploads: function () {

			// First remove array keys that don't have an assigned upload object
			this.uploads = $.grep( this.uploads,
				function ( v ) { return v !== undefined; }
			);

			// Now remove upload objects that exist but are empty
			this.removeMatchingUploads( function ( upload ) {
				return mw.isEmpty( upload.filename );
			} );
		},

		/**
		 * Clear out uploads that are in error mode, perhaps before proceeding to the next step
		 */
		removeErrorUploads: function () {
			this.removeMatchingUploads( function ( upload ) {
				return upload.state === 'error';
			} );
		},

		/**
		 * This is useful to clean out file inputs that we don't want for some reason (error, empty...)
		 * We are using a second array to iterate, because we will be splicing the main one, _this.uploads
		 * @param Function criterion: function to test the upload, returns boolean; true if should be removed
		 */
		removeMatchingUploads: function ( criterion ) {
			var toRemove = [];

			$.each( this.uploads, function ( i, upload ) {
				if ( upload === undefined ) {
					return;
				}
				if ( criterion( upload ) ) {
					toRemove.push( upload );
				}
			} );

			$.each( toRemove, function ( i, upload ) {
				if ( upload === undefined ) {
					return;
				}
				upload.remove();
			} );
		},

		/**
		 * Helper function to check whether the upload process is totally
		 * complete and we can safely leave the window.
		 */
		isComplete: function () {
			var complete = true;
			$.each( this.uploads, function ( i, upload ) {
				if ( upload !== undefined && upload.state !== 'complete' && upload.state !== 'thanks' ) {
					complete = false;
					return false;
				}
			} );
			return complete;
		},

		/**
		 * Kick off the upload processes.
		 * Does some precalculations, changes the interface to be less mutable, moves the uploads to a queue,
		 * and kicks off a thread which will take from the queue.
		 * @param endCallback   - to execute when uploads are completed
		 */
		startUploads: function () {
			var wizard = this;
			// remove the upload button, and the add file button
			$( '#mwe-upwiz-upload-ctrls' ).hide();
			this.steps.file.ui.hideEndButtons();
			$( '#mwe-upwiz-add-file' ).hide();

			// reset any uploads in error state back to be shiny & new
			$.each( this.uploads, function ( i, upload ) {
				if ( upload === undefined ) {
					return;
				}
				if ( upload.state === 'error' ) {
					upload.state = 'new';
					upload.ui.clearIndicator();
					upload.ui.clearStatus();
				}
			} );

			this.allowCloseWindow = mw.confirmCloseWindow( {
				message: function () { return mw.message( 'mwe-upwiz-prevent-close', wizard.uploads.length ).escaped(); },
				test: function () { return !wizard.isComplete() && wizard.uploads.length > 0; }
			} );

			this.steps.file.startProgressBar();

			// remove ability to change files
			// ideally also hide the "button"... but then we require styleable file input CSS trickery
			// although, we COULD do this just for files already in progress...

			// it might be interesting to just make this creational -- attach it to the dom element representing
			// the progress bar and elapsed time

			this.steps.file.transitionAll().done( function () {
				wizard.showNext( 'file', 'stashed' );
			} );
		},

		/**
		 * Figure out what to do and what options to show after the uploads have stopped.
		 * Uploading has stopped for one of the following reasons:
		 * 1) The user removed all uploads before they completed, in which case we are at upload.length === 0. We should start over and allow them to add new ones
		 * 2) All succeeded - show link to next step
		 * 3) Some failed, some succeeded - offer them the chance to retry the failed ones or go on to the next step
		 * 4) All failed -- have to retry, no other option
		 * In principle there could be other configurations, like having the uploads not all in error or stashed state, but
		 * we trust that this hasn't happened.
		 *
		 * For uploads that have succeeded, now is the best time to add the relevant previews and details to the DOM
		 * in the right order.
		 *
		 * @param {String} step that we are on
		 * @param {String} desired state to proceed (other state is assumed to be 'error')
		 */
		showNext: function ( step, desiredState, allOkCallback ) {
			var errorCount = 0,
				okCount = 0,
				stillGoing = 0,
				selector = null,
				allOk = false;

			// abort if all uploads have been removed
			if ( this.uploads.length === 0 ) {
				return;
			}

			$.each( this.uploads, function ( i, upload ) {
				if ( upload === undefined ) {
					return;
				}
				if ( upload.state === 'error' ) {
					errorCount++;
				} else if ( upload.state === desiredState ) {
					okCount++;
				} else if ( upload.state === 'transporting' ) {
					stillGoing += 1;
				}
			} );

			this.steps.file.updateProgressBarCount( okCount );

			if ( okCount === ( this.uploads.length - this.countEmpties() ) ) {
				allOk = true;
				selector = '.mwe-upwiz-file-next-all-ok';
			} else if ( errorCount === ( this.uploads.length - this.countEmpties() ) ) {
				selector = '.mwe-upwiz-file-next-all-failed';
			} else if ( stillGoing !== 0 ) {
				return;
			} else {
				selector = '.mwe-upwiz-file-next-some-failed';
			}

			if ( allOk && ( allOkCallback !== undefined ) ) {
				allOkCallback();
			} else {
				$( '#mwe-upwiz-stepdiv-' + step + ' .mwe-upwiz-buttons' ).show().find( selector ).show();
			}
		},

		/**
		 * Count the number of empty (undefined) uploads in our list.
		 * @TODO duplicated in the step prototype for now, delete when relevant
		 * things have all been moved to the step controllers.
		 */
		countEmpties: function () {
			var count = 0;
			$.each( this.uploads, function ( i, upload ) {
				if ( mw.isEmpty( upload ) ) {
					count += 1;
				}
			} );
			return count;
		},

		/**
		 * Submit all edited details and other metadata
		 * Works just like startUploads -- parallel simultaneous submits with progress bar.
		 * @return {jQuery.Promise}
		 */
		detailsSubmit: function () {
			var deferred = $.Deferred();

			// add the upload progress bar, with ETA
			// add in the upload count
			this.steps.details.transitionAll().done( function () {
				deferred.resolve();
			} );

			return deferred.promise();
		},

		/**
		 * The details page can be vertically long so sometimes it is not obvious there are errors above. This counts them and puts the count
		 * right next to the submit button, so it should be obvious to the user they need to fix things.
		 * This is a bit of a hack. The validator library actually already has a way to count errors but some errors are generated
		 * outside of that library. So we are going to just look for any visible inputs in an error state.
		 * This method also opens up "more info" if the form has errors.
		 */
		detailsErrorCount: function () {
			var errorCount,
				$errorElements = $( '#mwe-upwiz-stepdiv-details' )
					.find( '.mwe-error:not(:empty):not(#mwe-upwiz-details-error-count), input.mwe-validator-error, textarea.mwe-validator-error' );

			// Open "more info" if that part of the form has errors
			$errorElements.each( function () {
				if ( $( this ).parents( '.mwe-more-details' ).length === 1 ) {
					var moreInfo = $( this ).parents( '.detailsForm' ).find( '.mwe-upwiz-details-more-options a' );
					if ( !moreInfo.hasClass( 'mwe-upwiz-toggler-open' ) ) {
						moreInfo.click();
					}
				}
			} );

			errorCount = $errorElements.length;
			if ( errorCount > 0 ) {
				$( '#mwe-upwiz-details-error-count' ).msg( 'mwe-upwiz-details-error-count', errorCount, this.uploads.length );
				// Scroll to the first error
				$( 'html, body' ).animate( { scrollTop: $( $errorElements[0] ).offset().top - 50 }, 'slow' );
			} else {
				$( '#mwe-upwiz-details-error-count' ).empty();
			}
		}
	};

	/**
	 * Sanitizes a filename for use as a File: page title
	 * @static
	 * @param {string} filename Pre-sanitization filename.
	 * @return {string} Filename sanitized for use as a title.
	 */
	mw.UploadWizard.sanitizeFilename = function ( filename ) {
		var illegalCharRegex = new RegExp( '[' + mw.config.get( 'wgIllegalFileChars', '' ) + '#:%]', 'g' );
		return filename.replace( illegalCharRegex, '-' );
	};

	/**
	 * Get the own work and third party licensing deeds if they are needed.
	 *
	 * @static
	 * @since 1.2
	 * @param {number} uploadsLength
	 * @param {Object} config The UW config object.
	 * @return {mw.UploadWizardDeed[]}
	 */
	mw.UploadWizard.getLicensingDeeds = function ( uploadsLength, config ) {
		var deeds = [],
			doOwnWork = false,
			doThirdParty = false;

		this.api = this.api || new mw.Api( { ajax: { timeout: 0 } } );

		if ( config.licensing.ownWorkDefault === 'choice' ) {
			doOwnWork = doThirdParty = true;
		} else if ( config.licensing.ownWorkDefault === 'own' ) {
			doOwnWork = true;
		} else {
			doThirdParty = true;
		}

		if ( doOwnWork ) {
			deeds.push( new mw.UploadWizardDeedOwnWork( uploadsLength, this.api, config ) );
		}
		if ( doThirdParty ) {
			deeds.push( new mw.UploadWizardDeedThirdParty( uploadsLength, this.api, config ) );
		}

		return deeds;
	};

	/**
	 * Makes a modal dialog to confirm deletion of one or more uploads. Will have "Remove" and "Cancel" buttons
	 * @param {Array} array of UploadWizardUpload objects
	 * @param {String} message for dialog title
	 * @param {String} message for dialog text, which will precede an unordered list of upload titles.
	 */
	mw.UploadWizardDeleteDialog = function ( uploads, dialogTitle, dialogText ) {
		var $filenameList = $( '<ul></ul>' ),
			buttons = {};

		$.each( uploads, function ( i, upload ) {
			if ( upload === undefined ) {
				return;
			}
			$filenameList.append( $( '<li></li>' ).append( upload.title.getMain() ) );
		} );

		buttons[ mw.message( 'mwe-upwiz-remove', uploads.length ).escaped() ] = function () {
			$.each( uploads, function ( i, upload ) {
				if ( upload === undefined ) {
					return;
				}
				upload.remove();
			} );
			$( this ).dialog( 'close' );
		};
		buttons[ mw.message( 'mwe-upwiz-cancel', uploads.length ).escaped() ] = function () {
			$( this ).dialog( 'close' );
		};

		return $( '<div></div>' )
			.append( $( '<p></p>' ).append( dialogText ), $filenameList )
			.dialog( {
				width: 500,
				zIndex: 200000,
				autoOpen: false,
				title: dialogTitle,
				modal: true,
				buttons: buttons
			} );
	};

	mw.UploadWizardDeedPreview = function (upload) {
		this.upload = upload;
	};

	mw.UploadWizardDeedPreview.prototype = {

		setup: function () {
			// prepare a preview on the deeds page
			this.$thumbnailDiv = $( '<div></div>' ).addClass( 'mwe-upwiz-thumbnail' );
			this.upload.setThumbnail(
				this.$thumbnailDiv,
				mw.UploadWizard.config.thumbnailWidth,
				mw.UploadWizard.config.thumbnailMaxHeight,
				true
			);
		},

		remove: function () {
			if ( this.$thumbnailDiv ) {
				this.$thumbnailDiv.remove();
			}
		},

		// Has this preview been attached to the DOM already?
		isAttached: false,

		/*
		 * Append the div for this preview object to the DOM.
		 * We need to ensure that we add thumbs in the right order
		 * (the order in which the user selected files).
		 *
		 * Will only append once.
		 */
		attach: function () {
			if ( !this.isAttached ) {
				$( '#mwe-upwiz-deeds-thumbnails' ).append( this.$thumbnailDiv );
				this.isAttached = true;
			}
		}
	};

	/**
	 * Check if a value is null, undefined, or the empty string.
	 *
	 * @param {mixed} v Variable to be checked
	 * @return {boolean}
	 */
	mw.isEmpty = function ( v ) {
		return v === undefined || v === null || v === '';
	};

	$.fn.readonly = function () {
		return this.attr( 'readonly', 'readonly' ).addClass( 'mwe-readonly' );
	};

	/* will change in RTL, but I can't think of an easy way to do this with only CSS */
	$.fn.requiredFieldLabel = function () {
		this.addClass( 'mwe-upwiz-required-field' );
		return this.prepend( $( '<span/>' ).append( '*' ).addClass( 'mwe-upwiz-required-marker' ) );
	};

	/**
	 * Adds a tipsy pop-up help button to the field. Can be called in two ways -- with simple string id, which identifies
	 * the string as 'mwe-upwiz-tooltip-' plus that id, and creates the hint with a similar id
	 * or with function and id -- function will be called to generate the hint every time
	 * TODO v1.1 split into two plugins?
	 * @param key {string}  -- will base the tooltip on a message found with this key
	 * @param fn {function} optional -- call this function every time tip is created to generate message. If present HTML element gets an id of the exact key specified
	 */
	$.fn.addHint = function ( key, fn ) {
		var attrs, contentSource, html = false;
		if ( typeof fn === 'function' ) {
			attrs = { id: key };
			contentSource = fn;
			html = true;
		} else {
			attrs = { title:mw.message( 'mwe-upwiz-tooltip-' + key ).escaped() };
			contentSource = 'title';
		}
		return this.append(
			$( '<span/>' )
				.addClass( 'mwe-upwiz-hint' )
				.attr( attrs )
				.click( function () {
					if ( !this.displayed ) {
						$ ( this ).tipsy( 'show' );
						this.displayed = true;
					} else {
						$ ( this ).tipsy( 'hide' );
						this.displayed = false;
					}
					return false;
				} )
				.tipsy( { title: contentSource, html: html, opacity: 1.0, gravity: 'sw', trigger: 'manual' } )
		);
	};

	/**
	 * jQuery extension. Makes a textarea automatically grow if you enter overflow
	 * Stolen implementation from OOJS-UI. Thanks guys.
	 *
	 * @TODO Just use OOJS-UI for this instead of copying their code.
	 */
	jQuery.fn.growTextArea = function () {
		function resizeIfNeeded() {
		// Begin stolen code from OOJS-UI's TextInputWidget.prototype.adjustSize
			var $clone, scrollHeight, innerHeight, outerHeight, maxInnerHeight, measurementError, idealHeight,
				$this = $( this );

			$clone = $this.clone()
				.val( $this.val() )
				// Set inline height property to 0 to measure scroll height
				.css( { height: 0 } )
				.insertAfter( $this );

			scrollHeight = $clone[0].scrollHeight;
			// Remove inline height property to measure natural heights
			$clone.css( 'height', '' );
			innerHeight = $clone.innerHeight();
			outerHeight = $clone.outerHeight();
			// Measure max rows height
			$clone.attr( 'rows', 20 ).css( 'height', 'auto' ).val( '' );
			maxInnerHeight = $clone.innerHeight();
			// Difference between reported innerHeight and scrollHeight with no scrollbars present
			// Equals 1 on Blink-based browsers and 0 everywhere else
			measurementError = maxInnerHeight - $clone[0].scrollHeight;
			$clone.remove();
			idealHeight = Math.min( maxInnerHeight, scrollHeight + measurementError );
			// Only apply inline height when expansion beyond natural height is needed
			if ( idealHeight > innerHeight ) {
				// Use the difference between the inner and outer height as a buffer
				$this.css( 'height', idealHeight + ( outerHeight - innerHeight ) );
			} else {
				$this.css( 'height', '' );
			}
			// End stolen code from OOJS-UI's TextInputWidget.prototype.adjustSize
		}

		// this is a jquery-style object
		this.addClass( 'mwe-grow-textarea' );

		this.bind( 'resizeEvent', resizeIfNeeded );

		this.keyup( resizeIfNeeded );
		this.change( resizeIfNeeded );

		return this;
	};

	/**
	 * jQuery plugin - collapse toggle
	 * Given an element, makes contained elements of class mw-collapsible-toggle clickable to show/reveal
	 * contained element(s) of class mw-collapsible-content.
	 *
	 * Somewhat recapitulates mw.UploadWizardUtil.makeToggler,
	 * toggle() in vector.collapsibleNav.js, not to mention jquery.collapsible
	 * but none of those do what we want, or are inaccessible to us
	 *
	 * TODO: needs to iterate through elements, if we want to apply toggling behavior to many elements at once
	 * TODO: add a method to open and close besides clicking
	 */
	jQuery.fn.collapseToggle = function () {
		var $el = this,
			$contents = $el.find( '.mwe-upwiz-toggler-content' ).hide(),
			$toggle = $el.find( '.mwe-upwiz-toggler' ).addClass( 'mwe-upwiz-more-options' );
		$el.data( 'open', function () {
			$contents.slideDown( 250 );
			$toggle.addClass( 'mwe-upwiz-toggler-open' );
		} );
		$el.data( 'close', function () {
			$contents.slideUp( 250 );
			$toggle.removeClass( 'mwe-upwiz-toggler-open' );
		} );
		$toggle.click( function ( e ) {
			e.stopPropagation();
			if ( $toggle.hasClass( 'mwe-upwiz-toggler-open' ) ) {
				$el.data( 'close' )();
			} else {
				$el.data( 'open' )();
			}
		} );
		return this;
	};

	$.validator.setDefaults( {
		debug: true,
		errorClass: 'mwe-validator-error'
	} );
} )( mediaWiki, mediaWiki.uploadWizard, jQuery );
