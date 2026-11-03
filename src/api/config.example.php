<?php
// Copy to config.local.php ON THE SERVER. Never put secrets in the JS build .env.
return [
    'org_id' => getenv('CHERRY_PICKER_ORG_ID') ?: '', // WxCC organization UUID
    'storage_dir' => getenv('CHERRY_PICKER_STORAGE_DIR') ?: '', // absolute, outside document root
    'webhook_secret' => getenv('CHERRY_PICKER_WEBHOOK_SECRET') ?: '',
    'allowed_origins' => ['https://desktop.wxcc-us1.cisco.com'],
    'caller_ttl' => 3600,
    'transfer_ttl' => 900,
    'max_hold_attempts' => 5,
];
