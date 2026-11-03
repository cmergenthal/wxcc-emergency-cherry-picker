<?php
// TEST ONLY. The HTTP harness disables cURL functions and mocks Webex identity responses.
// This file is never included in the deployment package.
function curl_init($url) { return new stdClass(); }
function curl_setopt_array($handle, $options) { $handle->options = $options; return true; }
function curl_exec($handle) {
    $auth = $handle->options[CURLOPT_HTTPHEADER][0] ?? '';
    if ($auth === 'Authorization: Bearer test-agent') return json_encode(['id' => 'agent-1', 'orgId' => base64_encode('ciscospark://us/ORGANIZATION/test-org')]);
    if ($auth === 'Authorization: Bearer other-agent') return json_encode(['id' => 'agent-2', 'orgId' => 'test-org']);
    if ($auth === 'Authorization: Bearer foreign-agent') return json_encode(['id' => 'agent-3', 'orgId' => 'other-org']);
    return '{}';
}
function curl_getinfo($handle, $option) { return 200; }
function curl_close($handle) {}
return false;
