<?php
require_once __DIR__ . '/common.php';
endpoint(function (array $config, array $body) {
    agent_auth($config);
    $ids = $body['taskIds'] ?? null;
    if (!is_array($ids) || !array_is_list($ids) || count($ids) > 200) respond(400, ['error' => 'Expected up to 200 taskIds']);
    foreach ($ids as $id) required_string(['id' => $id], 'id');
    return store_transaction($config['storage_dir'], 'callers', function (&$records) use ($config, $ids) {
        $result = [];
        foreach ($ids as $id) {
            $record = $records[record_key($config['org_id'], $id)] ?? null;
            $result[] = $record ? $record['data'] + ['found' => true] : ['InteractionId' => $id, 'found' => false];
        }
        return $result;
    });
});
