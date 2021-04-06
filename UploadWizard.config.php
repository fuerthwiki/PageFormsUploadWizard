<?php
/**
 * Upload Wizard Configuration
 * Do not modify this file, instead use localsettings.php and set:
 * $wgUploadWizardConfig[ 'name'] =  'value';
 */
global $wgFileExtensions, $wgServer, $wgScriptPath, $wgAPIModules, $wgLang,
	$wgCheckFileExtensions, $wgUser, $wgWBRepoSettings;

$userLangCode = $wgLang->getCode();
// Commons only: ISO 646 code of Tagalog is 'tl', but language template is 'tgl'
$uwDefaultLanguageFixups = [ 'tl' => 'tgl' ];

$cache = \MediaWiki\MediaWikiServices::getInstance()->getMainWANObjectCache();
$uwLanguages = $cache->getWithSetCallback(
	// We need to get a list of languages for the description dropdown.
	// Increase the 'version' number in the options below if this logic or format changes.
	$cache->makeKey( 'uploadwizard-language-templates', $userLangCode ),
	$cache::TTL_DAY,
	function () use ( $userLangCode, $uwDefaultLanguageFixups ) {
		global $wgUploadWizardConfig;

		$uwLanguages = [];

		// First, get a list of languages we support.
		$baseLangs = Language::fetchLanguageNames( $userLangCode, 'all' );
		// We need to take into account languageTemplateFixups
		if (
			is_array( $wgUploadWizardConfig ) &&
			array_key_exists( 'languageTemplateFixups', $wgUploadWizardConfig )
		) {
			$languageFixups = $wgUploadWizardConfig['languageTemplateFixups'];
			if ( !is_array( $languageFixups ) ) {
				$languageFixups = [];
			}
		} else {
			$languageFixups = $uwDefaultLanguageFixups;
		}
		// Use LinkBatch to make this a little bit more faster.
		// It works because $title->exists (below) will use LinkCache.
		$linkBatch = new LinkBatch();
		foreach ( $baseLangs as $code => $name ) {
			$fixedCode = array_key_exists( $code, $languageFixups ) ? $languageFixups[$code] : $code;
			if ( is_string( $fixedCode ) && $fixedCode !== '' ) {
				$title = Title::makeTitle( NS_TEMPLATE, Title::capitalize( $fixedCode, NS_TEMPLATE ) );
				$linkBatch->addObj( $title );
			}
		}
		$linkBatch->execute();

		// Then, check that there's a template for each one.
		foreach ( $baseLangs as $code => $name ) {
			$fixedCode = array_key_exists( $code, $languageFixups ) ? $languageFixups[$code] : $code;
			if ( is_string( $fixedCode ) && $fixedCode !== '' ) {
				$title = Title::makeTitle( NS_TEMPLATE, Title::capitalize( $fixedCode, NS_TEMPLATE ) );
				if ( $title->exists() ) {
					// If there is, then it's in the final picks!
					$uwLanguages[$code] = $name;
				}
			}
		}

		// Skip the duplicate deprecated language codes if the new one is okay to use.
		foreach ( LanguageCode::getDeprecatedCodeMapping() as $oldKey => $newKey ) {
			if ( isset( $uwLanguages[$newKey] ) && isset( $uwLanguages[$oldKey] ) ) {
				unset( $uwLanguages[$oldKey] );
			}
		}

		// Sort the list by the language name.
		if ( class_exists( Collator::class ) ) {
			// If a specific collation is not available for the user's language,
			// this falls back to a generic 'root' one.
			$collator = Collator::create( $userLangCode );
			$collator->asort( $uwLanguages );
		} else {
			natcasesort( $uwLanguages );
		}

		return $uwLanguages;
	},
	[
		'version' => 3,
	]
);

return [
	// Upload wizard has an internal debug flag
	'debug' => false,

	// The default campaign to use.
	'defaultCampaign' => '',

	// Enable or disable the default upload license user preference
	'enableLicensePreference' => true,

	// Number of seconds to cache Campaign pages in squid, for anon users
	'campaignSquidMaxAge' => 10 * 60,

	// Enable or disable campaignstats that are expensive to compute
	'campaignExpensiveStatsEnabled' => true,

	// Number of seconds to cache Campaign stats
	// Currently affects: Contributors count for each campaign
	'campaignStatsMaxAge' => 60,

	// Name of Campaign (as defined by Extension:Campaigns) to use for anon signup CTA
	// Is used only if Campaign extension is detected
	// $1 is replaced by the uploadcampaign name
	'campaignCTACampaignTemplate' => 'uploadCampaign:$1',

	// File extensions acceptable in this wiki
	'fileExtensions' => $wgCheckFileExtensions ? $wgFileExtensions : null,

	// Flickr details
	// Flickr API is SSL-only as of June 27th, 2014:
	// http://code.flickr.net/2014/04/30/flickr-api-going-ssl-only-on-june-27th-2014/
	'flickrApiUrl' => 'https://api.flickr.com/services/rest/?',

	// you should probably replace this with your own
	'flickrApiKey' => 'aeefff139445d825d4460796616f9349',

	// name of wiki page with blacklist of Flickr users
	'flickrBlacklistPage' => '',

	// Settings about things that get automatically (and silently) added to uploads
	'autoAdd' => [
		// Categories to automatically (and silently) add all uploaded images into.
		'categories' => [],

		// WikiText to automatically (and silently) add to all uploaded images.
		'wikitext' => '',
	],

	// If the user didn't add categories, or removed the default categories, add this wikitext.
	// Use this to indicate that some human should categorize this file.
	// Does not consider autoAdd.categories, which are hidden.
	'missingCategoriesWikiText' => '',

	'display' => [
		// wikitext to display above the UploadWizard UI.
		'headerLabel' => '',

		// wikitext to display on top of the "use" page.
		// When not provided, the message mwe-upwiz-thanks-intro will be used.
		'thanksLabel' => '',

		// checkbox label to display with each entry on the upload page to choose one image that
		// should be used as an image thumbnail for the referenced object
		// When not provided, the message mwe-upwiz-objref-pick-image will be used.
		'labelPickImage' => '',

		// wikitext to display with each entry on the upload page to inform the users that there
		// already is an image thumbnail for the referenced object
		// When not provided, the message mwe-upwiz-objref-notice-existing-image will be used.
		'noticeExistingImage' => '',

		// wikitext to display on top of the "use" page if an image was marked with an object reference
		// When not provided, the message mwe-upwiz-objref-notice-update-delay will be used.
		'noticeUpdateDelay' => ''
	],

	// Settings for the tutorial to be shown.
	// Empty array if we want to skip
	'tutorial' => [
		// Set to true to skip the tutorial
		'skip' => false,

		// Name of the tutorial on Wikimedia Commons. The $1 is replaced with the language desired.
		'template' => 'Licensing_tutorial_$1.svg',

		// The width we want to scale the tutorial to, for our interface.
		'width' => 720,

		// Imagemap coordinates of the "helpdesk" button at the bottom, which is supposed to be clickable.
		// Empty string or false to not have an imagemap linked to the helpdesk.
		'helpdeskCoords' => '27, 1319, 691, 1384',
	],

	// Tracking categories for various scenarios
	'trackingCategory' => [
		// Category added no matter what
		// Default to none because we don't know what categories
		// exist or not on local wikis.
		// Do not uncomment this line, set
		// $wgUploadWizardConfig['trackingCategory']['all']
		// to your favourite category name.

		// 'all' => '',

		// Tracking category added for campaigns. $1 is replaced with campaign page name
		'campaign' => 'Uploaded via Campaign:$1'
	],

	'fields' => [
		// Field via which an ID can be provided.
		[
			// When non empty, this field will be shown, and $1 will be replaced by it's value.
			'wikitext' => '',

			// Label text to display with the field. Is parsed as wikitext.
			'label' => '',

			// The maximum length of the id field.
			'maxLength' => 25,

			// Initial value for the id field.
			'initialValue' => '',

			// Set to true if this field is required
			'required' => false,

			// Define the type of widget that will be rendered,
			// pick between text and select
			'type' => "text",

			// If the type above is select, provide a dictionary of
			// value -> label associations to display as options
			'options' => [ /* 'value' => 'label' */ ]
		]
	],

	'defaults' => [
		// Categories to list by default in the list of cats to add.
		'categories' => [],

		// Initial value for the caption field.
		'caption' => '',

		// Initial value for the description field.
		'description' => '',

		// @codingStandardsIgnoreStart

		// These values are commented out by default, so they can be undefined
		// Define them here if you want defaults.
		// This is required, because the JsonSchema for these defines them to be type number
		// But we can't have them to be NULL, because that's not a number.
		// This is a technical limitation of JsonSchema, I think.

		//// Initial value for the latitude field.
		//'lat' => 0,

		//// Initial value for the longitude field.
		//'lon' => 0,

		//// Initial value for the altitude field. (unused)
		//'alt' => 0,

		//// Initial value for the heading field.
		//'heading' => 0,

		// @codingStandardsIgnoreEnd
	],

	// Max author string length
	'maxAuthorLength' => 10000,

	// Min author string length
	'minAuthorLength' => 1,

	// Max source string length
	'maxSourceLength' => 10000,

	// Min source string length
	'minSourceLength' => 5,

	// Max file title string length
	'maxTitleLength' => 240,

	// Min file title string length
	'minTitleLength' => 5,

	// Max file caption length
	'maxCaptionLength' => $wgWBRepoSettings['string-limits']['multilang']['length'] ?? 250,

	// Min file caption length
	'minCaptionLength' => 5,

	// Max file description length
	'maxDescriptionLength' => 10000,

	// Min file description length
	'minDescriptionLength' => 5,

	// Max length for other file information:
	'maxOtherInformationLength' => 10000,

	// Max number of simultaneous upload requests
	'maxSimultaneousConnections' => 3,

	// Max number of uploads for a given form
	'maxUploads' => $wgUser->isAllowed( 'mass-upload' ) ? 500 : 50,

	// Max number of files that can be imported from Flickr at one time (T236341)
	// Note that these numbers should always be equal to or less than the maxUploads above.
	'maxFlickrUploads' => $wgUser->isAllowed( 'mass-upload' ) ? 500 : 4,

	// Max file size that is allowed by PHP (may be higher/lower than MediaWiki file size limit).
	// When using chunked uploading, these limits can be ignored.
	'maxPhpUploadSize' => UploadBase::getMaxPhpUploadSize(),

	// Max file size that is allowed by MediaWiki. This limit can never be ignored.
	'maxMwUploadSize' => UploadBase::getMaxUploadSize( 'file' ),

	// Minimum length of custom wikitext for a license, if used.
	// It is 6 because at minimum it needs four chars for opening and closing
	// braces, then two chars for a license, e.g. {{xx}}
	'minCustomLicenseLength' => 6,

	// Maximum length of custom wikitext for a license
	'maxCustomLicenseLength' => 10000,

	// License template custom licenses should transclude (if any)
	// This is the prefixed db key (e.g. Template:License_template_tag), or
	// false to disable this check
	'customLicenseTemplate' => false,

	// @codingStandardsIgnoreStart
	// The UploadWizard allows users to provide file descriptions in multiple languages. For each description, the user
	// can choose the language. The UploadWizard wraps each description in a "language template". A language template is
	// by default assumed to be a template with a name corresponding to the ISO 646 code of the language. For instance,
	// Template:en for English, or Template:fr for French. This mechanism is used for instance at Wikimedia Commons.
	// If this is not the case for some or all or your wiki's language templates, this map can be used to define the
	// template names to be used. Keys are ISO 646 language codes, values are template names. The default defines the
	// exceptions used at Wikimedia Commons: the language template for Tagalog (ISO 646 code 'tl') is not named 'tl'
	// but 'tgl' for historical reasons.
	// @codingStandardsIgnoreEnd
	'languageTemplateFixups' => $uwDefaultLanguageFixups,

		// @codingStandardsIgnoreStart
		// XXX this is horribly confusing -- some file restrictions are client side, others are server side
		// the filename prefix blacklist is at least server side -- all this should be replaced with PHP regex config
		// or actually, in an ideal world, we'd have some way to reliably detect gibberish, rather than trying to
		// figure out what is bad via individual regexes, we'd detect badness. Might not be too hard.
		//
		// we can export these to JS if we so want.
		// filenamePrefixBlacklist: wgFilenamePrefixBlacklist,
		//
		// filenameRegexBlacklist: [
		//	/^(test|image|img|bild|example?[\s_-]*)$/,  // test stuff
		//	/^(\d{10}[\s_-][0-9a-f]{10}[\s_-][a-z])$/   // flickr
		// ]
		// @codingStandardsIgnoreEnd

	// Link to page where users can leave feedback or bug reports.
	// Defaults to UploadWizard's bug tracker.
	// If you want to use a wiki page, set this to a falsy value,
	// and set feedbackPage to the name of the wiki page.
	// @codingStandardsIgnoreStart
	'feedbackLink' => '',
	// @codingStandardsIgnoreEnd

	// [deprecated] Wiki page for leaving Upload Wizard feedback,
	// for example 'Commons:Upload wizard feedback'
	'feedbackPage' => '',

	// Link to page containing a list of categories that the user can use for uploaded files.
	// Shown on the Details stage, above the category selection field.
	'allCategoriesLink' => 'https://commons.wikimedia.org/wiki/Commons:Categories',

	// @codingStandardsIgnoreStart
	// Title of page for alternative uploading form, e.g.:
	//   'altUploadForm' => 'Special:Upload',
	//
	// If different pages are required for different languages,
	// supply an object mapping user language code to page. For a catch-all
	// page for all languages not explicitly configured, use 'default'. For instance:
	//   array(
	//		'default'	=> 'Commons:Upload',
	//		'de'		=> 'Commons:Hochladen'
	//	 );
	// @codingStandardsIgnoreEnd
	'altUploadForm' => '',

	// Wiki page that lists alternative ways to upload
	'alternativeUploadToolsPage' => 'Commons:Upload_tools',

	// Wiki page for reporting issues with the blacklist
	'blacklistIssuesPage' => '',

	// When using chunked upload, what size, in bytes, should each chunk be?
	'chunkSize' => 5 * 1024 * 1024,

	// Should feature to copy metadata across a batch of uploads be enabled?
	'copyMetadataFeature' => true,

	// Should we pester the user with a confirmation step when submitting a file without assigning it
	// to any categories?
	'enableCategoryCheck' => true,

	// enable structured data to go into a wikibase repository
	'wikibase' => [
		'enabled' => false,
		'captions' => true,
		'statements' => true,
		'nonDefaultStatements' => true,
		// url to wikibase repo API
		'api' => $wgScriptPath . '/api.php',
	],
];
