"""Local PHP HTTP contract tests. Only upstream Webex identity is mocked."""
import json, os, pathlib, shutil, socket, subprocess, tempfile, time, urllib.request, urllib.error
src = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='cherry-picker-http-') as tmp:
    root = pathlib.Path(tmp) / 'public'
    shutil.copytree(src / 'api', root / 'api')
    (root / 'api/config.local.php').write_text("<?php return ['org_id'=>'test-org','storage_dir'=>" + repr(tmp + '/private') + ", 'webhook_secret'=>str_repeat('s',32),'allowed_origins'=>['https://desktop.wxcc-us1.cisco.com'],'caller_ttl'=>3600,'transfer_ttl'=>900,'max_hold_attempts'=>5];")
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    with tempfile.TemporaryFile() as log:
        server = subprocess.Popen(['php', '-d', 'disable_functions=curl_init,curl_setopt_array,curl_exec,curl_getinfo,curl_close', '-S', f'127.0.0.1:{port}', '-t', str(root), str(src / 'tests/identity-router.php')], stdout=log, stderr=log)
        try:
            for _ in range(100):
                try:
                    with socket.create_connection(('127.0.0.1',port),timeout=.1): break
                except OSError: time.sleep(.05)
            else:
                log.seek(0); raise RuntimeError(log.read().decode())
            def request(endpoint, data=None, auth=None, secret=None, method='POST', origin=None, raw=None):
                headers={'Content-Type':'application/json'}
                if auth: headers['Authorization']='Bearer '+auth
                if secret: headers['X-Webhook-Secret']=secret
                if origin: headers['Origin']=origin
                req=urllib.request.Request(f'http://127.0.0.1:{port}/api/{endpoint}.php',data=raw if raw is not None else json.dumps(data or {}).encode(),headers=headers,method=method)
                try: response=urllib.request.urlopen(req)
                except urllib.error.HTTPError as e: response=e
                payload=response.read()
                return response.status, json.loads(payload) if payload else None
            secret='s'*32
            assert request('webhook',{})[0] == 401
            assert request('webhook',secret=secret,raw=b'{broken')[0] == 400
            assert request('webhook',{'OrgId':'wrong','InteractionId':'call'},secret=secret)[0] == 403
            assert request('caller-ids',{'taskIds':['call']})[0] == 401
            assert request('caller-ids',{'taskIds':['call']},auth='foreign-agent')[0] == 403
            assert request('caller-ids',auth='test-agent',origin='https://evil.example')[0] == 403
            assert request('caller-ids',origin='https://desktop.wxcc-us1.cisco.com',method='OPTIONS')[0] == 204
            assert request('webhook',method='GET')[0] == 405
            status, rows=request('caller-ids',{'taskIds':['call']},auth='test-agent')
            assert status == 200 and rows[0]['found'] is False
            assert request('webhook',{'OrgId':'test-org','InteractionId':'call','ANI':'123','Headers':''},secret=secret)[0] == 200
            status,rows=request('caller-ids',{'taskIds':['call']},auth='test-agent')
            assert status == 200 and rows[0]['found'] is True and rows[0]['ANI']=='123'
            transfer={'transferTaskId':'call','number':'123','agentNumber':'1000','command':'transfer-hold'}
            assert request('transfer-state',transfer,auth='test-agent')[0] == 200
            assert request('transfer-hold',{'transferTaskId':'call'},secret=secret)[1]['ready'] is False
            transfer['command']='transfer-merge'
            assert request('transfer-state',transfer,auth='other-agent')[0] == 409
            assert request('transfer-state',transfer,auth='test-agent')[0] == 200
            assert request('transfer-hold',{'transferTaskId':'call'},secret=secret)[1]['ready'] is True
            transfer['command']='transfer-hold'
            assert request('transfer-state',transfer,auth='test-agent')[0] == 200
            assert request('transfer-hold',{'transferTaskId':'call'},secret=secret)[1]['ready'] is True
            transfer['transferTaskId']='call-2'
            assert request('transfer-state',transfer,auth='test-agent')[0] == 200
            assert request('transfer-hold',{'transferTaskId':'call-2'},secret=secret)[1]['ready'] is False
            timeout=request('transfer-hold',{'transferTaskId':'missing','attempt':5},secret=secret)[1]
            assert timeout['ready'] is False and timeout['timedOut'] is True
            print('PASS: HTTP validation, auth/org/CORS, delayed metadata, transfer ownership, idempotency, distinct same-number transfers, missing-state timeout')
        finally:
            server.terminate(); server.wait(timeout=5)
