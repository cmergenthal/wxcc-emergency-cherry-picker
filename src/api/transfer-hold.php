<?php
require_once __DIR__ . '/common.php';
endpoint(function (array $config, array $body) {
    flow_auth($config);
    $id = required_string($body, 'transferTaskId');
    $attempt = $body['attempt'] ?? 0;
    if (filter_var($attempt, FILTER_VALIDATE_INT) === false || $attempt < 0 || $attempt > 10000) respond(400, ['error' => 'Invalid attempt']);
    return store_transaction($config['storage_dir'], 'transfers', function (&$records) use ($config, $id, $attempt) {
        $record = $records[record_key($config['org_id'], $id)] ?? null;
        $timeout = $attempt >= $config['max_hold_attempts'];
        return ['ready' => $record !== null && ($record['ready'] || $timeout), 'timedOut' => $timeout,
            'found' => $record !== null, 'attempt' => (int)$attempt + 1,
            'agentNumber' => $record['agentNumber'] ?? null];
    });
});
