<?php
require_once __DIR__ . '/common.php';
endpoint(function (array $config, array $body) {
    flow_auth($config);
    $id = required_string($body, 'InteractionId');
    if (normalize_org(required_string($body, 'OrgId')) !== normalize_org($config['org_id'])) {
        respond(403, ['error' => 'Organization does not match']);
    }
    $data = ['InteractionId' => $id, 'OrgId' => $config['org_id']];
    foreach (['ANI', 'DNIS', 'Headers'] as $field) {
        if (isset($body[$field])) {
            if (!is_string($body[$field]) || strlen($body[$field]) > 16000) respond(400, ['error' => 'Invalid ' . $field]);
            $data[$field] = $body[$field];
        }
    }
    return store_transaction($config['storage_dir'], 'callers', function (&$records) use ($config, $id, $data) {
        $records[record_key($config['org_id'], $id)] = ['expiresAt' => time() + $config['caller_ttl'], 'data' => $data];
        return ['ok' => true];
    });
});
