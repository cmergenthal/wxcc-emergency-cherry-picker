// Public widget configuration. No secrets or access tokens belong here.
window.CHERRY_PICKER_CONFIG = {
  apiBaseUrl: './api/', // resolved relative to config.js; supports a hosting subfolder
  wxccApiBaseUrl: 'https://api.wxcc-us1.cisco.com',
  wrapUpCodeId: '',
  autoWrapUpOnTransfer: false, // set true with a valid code ID and exact reason name below
  transferWrapUpReason: '', // exact name of the configured wrap-up code
  holdExtension: '',
  conferenceEnabled: false, // enable after configuring and testing the hold/return flow
  // Optional compact header widget; merge these into an existing hosted config.
  emergencyQueueName: '', // required exact queue name unless emergencyQueueId is set
  emergencyQueueId: '', // optional exact queue ID, preferred if names can change
  emergencyTransferMode: 'original', // return the existing call to its original queue
  emergencyTransferQueueId: '', // optional fixed destination, overrides original queue
  emergencyLookbackMs: 86400000, // newest waiting contact created within 24 hours
  pollIntervalMs: 5000
};
