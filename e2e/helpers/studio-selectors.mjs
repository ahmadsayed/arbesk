export const SELECTORS = {
  testnetBanner: "#testnetBanner",
  // Header network status (dot + label); the network select lives in the
  // wallet popover (#headerbarNetworkSelect).
  networkStatus: "#networkStatus",
  connectWalletBtn: "#connectWalletBtn",
  disconnectWalletBtn: "#disconnectWalletBtn",
  walletOptionsList: "#walletOptionsList",
  hardhatWalletOption: '[data-rdns="com.arbesk.hardhat-test"]',
  walletEmailInput: "#walletEmailInput",
  walletEmailSendBtn: "#walletEmailSendBtn",
  walletOtpInput: "#walletOtpInput",
  walletOtpVerifyBtn: "#walletOtpVerifyBtn",
  walletModalTitle: "#wallet-modal-title",
  promptInput: "#promptInput",
  generateBtn: "#generateBtn",
  clearChatBtn: "#clearChatBtn",
  generateHint: "#generateHint",
  imageAttachBtn: "#imageAttachBtn",
  imageAttachInput: "#imageAttachInput",
  imageAttachChips: "#imageAttachChips",
  multiviewHint: "#multiviewHint",
  chatHistoryList: "#chatHistoryList",
  chatHistoryBubbles: ".chat-bubble-history",
  // Asset chat bubble (generation result pending a "Show in Studio" decision)
  assetBubble: ".chat-bubble-asset",
  assetBubbleSend: ".chat-bubble-asset .chat-asset-send",
  assetBubbleCanvas: ".chat-bubble-asset .chat-asset-canvas",
  assetBubbleFollowups: ".chat-bubble-asset .chat-asset-followups",
  /**
   * @param {string} action
   * @returns {string}
   */
  assetBubbleAction: (action) => `.chat-bubble-asset [data-action="${action}"]`,
  assetBubbleSaved: ".chat-bubble-asset.chat-bubble-asset-saved",
  refineIndicator: "#refineIndicator",
  refineIndicatorText: "#refineIndicatorText",
  refineIndicatorDetach: "#refineIndicatorDetach",
  versionBubble: ".chat-bubble-version",
  choiceBubble: ".chat-bubble-choices",
  choiceBtn: ".chat-choice-btn",
  /**
   * @param {string} label
   * @returns {string}
   */
  choiceButton: (label) => `.chat-bubble-choices .chat-choice-btn:has-text("${label}")`,
  saveAssetBtn: "#saveAssetBtn",
  publishAssetBtn: "#publishAssetBtn",
  downloadAssetBtn: "#downloadAssetBtn",
  taskProgress: "#taskProgress",
  taskProgressLabel: "#taskProgressLabel",
  taskProgressFill: "#taskProgressFill",
  assetStatusName: "#assetStatusName",
  assetStatusMeta: "#assetStatusMeta",
  srStatus: "#srStatus",
  dialogInput: ".dialog-input",
  dialogConfirmBtn: ".dialog-confirm-btn",
  dialogActionBtn: ".dialog-action-btn",
  dialogCancelBtn: '.dialog-action-btn[data-value="cancel"]',
  dialogForkBtn: '.dialog-action-btn[data-value="fork"]',
  dialogLiveRefBtn: '.dialog-action-btn[data-value="live-ref"]',
  dialogDeleteBtn: '.dialog-action-btn[data-value="delete"]',
  providerSelect: "#providerSelect",
  tierSelect: "#tierSelect",
  assetNameDisplay: "#assetNameDisplay",
  // Studio "Assets" tab (formerly Gallery): placement picker
  gallerySwitcherBtn: '[data-view="library"]',
  createSwitcherBtn: '[data-view="chat"]',
  assetLibraryBody: "#assetLibraryBody",
  galleryVisitorBadge: "#galleryVisitorBadge",
  assetCard: ".asset-card",
  assetCardName: ".asset-card-name",
  // Outliner (scene graph tree)
  outlinerSwitcherBtn: '[data-view="outline"]',
  outlinerNode: ".outliner-node",
  outlinerRemoveBtn: "#outlinerRemoveBtn",
  // Parametric component (color) editor inside the Node Inspector
  componentEditor: "#componentEditor",
  componentColorInput: "#selectedComponentColor",
  // Version history / time-travel
  versionTimeline: "#versionTimeline",
  vtTicks: "#versionTimeline .vt-tick",
  vtActiveTick: "#versionTimeline .vt-tick[aria-current='true']",
  vtTooltip: ".vt-tooltip",
  modelClockBadge: "#modelClockBadge",
  timeModeButton: '#transformToolbar [data-mode="time"]',
  // Undo/redo (viewport toolbar) + inspector scale field
  undoButton: "#undoBtn",
  redoButton: "#redoBtn",
  scaleFactorInput: "#nodeScaleFactor",
  scaleSectionSummary: "#scaleSection summary",
  // View / Edit mode (viewport toolbar) + unsaved marker (header)
  editModeButton: "#editModeBtn",
  dropToFloorButton: "#dropToFloorBtn",
  resetTransformButton: "#resetTransformBtn",
  lockFloorToggle: "#lockFloorBtn",
  unsavedMarker: "#saveAssetBtn.has-unsaved",
  assetMeta: "#assetStatusMeta",
  animationsSection: "#animationsSection",
  animationSelect: "#animationSelect",
  // New ▾ menu ("Empty asset" keeps the #newAssetBtn id inside it) + nesting
  // (linked child assets)
  newMenuBtn: "#newMenuBtn",
  newMenu: "#newMenu",
  newAssetBtn: "#newAssetBtn",
  // Properties → Asset (name, collection, tier, team); hidden with no asset.
  assetSection: "#assetSection",
  collectionSelect: "#collectionSelect",
  assetTokenIdLabel: "#assetStatusMeta",
  inspectorDiveBtn: "#inspectorDiveBtn",
  backBtn: "#backBtn",
  // Settings / team (collaborators) panel
  teamPanel: "#teamPanel",
  collaboratorList: "#collaboratorList",
  collaboratorAddInput: "#collaboratorAddInput",
  collaboratorAddBtn: "#collaboratorAddBtn",
  collaboratorRoleSelect: "#collaboratorRoleSelect",
  /**
   * @param {string} address
   * @returns {string}
   */
  teamItemByAddress: (address) =>
    `#collaboratorList .team-item[data-address="${address.toLowerCase()}"]`,
  /**
   * @param {string} text
   * @returns {string}
   */
  contextMenuItemByText: (text) => `.context-menu-item:text-is("${text}")`,
  // Comments section in right inspector
  commentsSection: "#commentsSection",
  commentList: "#commentList",
  commentItem: ".comment-item",
  commentComposerInput: "#commentComposerInput",
  postCommentBtn: "#postCommentBtn",
  commentsCount: "#commentsCount",
  commentsEmpty: "#commentsEmpty",
  // Inspector metadata section (computed facts + editable annotations)
  metadataSection: "#metadataSection",
  metadataAddBtn: "#metadataAddBtn",
  metadataAnnotationsList: "#metadataAnnotationsList",
  // Print & Provenance typed fields + printability + status-bar readout
  metaLicence: "#metaLicence",
  metaUnits: "#metaUnits",
  printCheckBtn: "#printCheckBtn",
  printBadge: "#printBadge",
  bottomBarAssetInfo: "#bottomBarAssetInfo",
  // Library / collection browser
  libraryGate: "#libraryGate",
  libraryMain: "#libraryMain",
  libraryConnectBtn: "#libraryConnectBtn",
  libraryItems: "#libraryItems",
  libraryItem: "[data-id]",
  libraryCollectionItem: '[data-type="collection"]',
  libraryAssetItem: '[data-type="asset"]',
  libraryItemName: ".library-item-name",
  libraryBreadcrumb: "#libraryBreadcrumb",
  libraryBreadcrumbHome: '#libraryBreadcrumb [data-collection-token-id=""]',
  libraryUpBtn: "#libraryUpBtn",
  librarySearchInput: "#librarySearchInput",
  librarySortSelect: "#librarySortSelect",
  libraryGridViewBtn: "#libraryGridViewBtn",
  libraryListViewBtn: "#libraryListViewBtn",
  libraryCreateCollectionBtn: "#libraryCreateCollectionBtn",
  libraryUploadBtn: "#libraryUploadBtn",
  libraryUploadInput: "#libraryUploadInput",
  libraryDropOverlay: "#libraryDropOverlay",
  libraryItemCount: "#libraryItemCount",
  libraryLiveRegion: "#libraryLiveRegion",
  libraryDetailsToggleBtn: "#libraryDetailsToggleBtn",
  libraryDetails: "#libraryDetails",
  libraryDetailsEmpty: "#libraryDetailsEmpty",
  libraryDetailsTitle: "#libraryDetailsTitle",
  libraryDetailsMetadata: "#libraryDetailsMetadata",
  libraryDetailsEditMetadataBtn: "#libraryDetailsEditMetadataBtn",
  libraryVisitorBadge: "#libraryVisitorBadge",
  contextMenu: ".context-menu",
  contextMenuItem: ".context-menu-item",
};
