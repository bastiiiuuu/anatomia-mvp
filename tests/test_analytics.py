import tempfile
import time
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from backend.analytics import create_app, ORIGIN, IP_HEADER, RETENTION


class TrafficTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.secret = 'test-secret-not-used-in-production-'+'a'*32
        self.app = create_app(Path(self.temp.name)/'traffic.sqlite3', self.secret, trust_proxy=True)
        self.remote = TestClient(self.app, base_url='https://traffic.test', client=('203.0.113.9',5000))
        self.proxy = TestClient(self.app, base_url='https://traffic.test', client=('127.0.0.1',5000))
        self.body = {'id':'01234567-1234-1234-1234-123456789abc','path':'/anatomia-mvp/','device':'Tablet','referrer':'https://example.test/private?secret=never-retained'}

    def tearDown(self):
        self.remote.close(); self.proxy.close(); self.temp.cleanup()

    def login(self, client=None):
        client = client or self.remote
        return client.post('/admin/api/login', json={'token':self.secret}, headers={'Origin':'https://traffic.test'})

    def test_collection_is_idempotent_and_never_returns_addresses(self):
        for _ in range(2):
            r=self.remote.post('/collect',json=self.body,headers={'Origin':ORIGIN,IP_HEADER:'1.2.3.4'})
            self.assertEqual(r.status_code,204);self.assertEqual(r.content,b'')
        self.assertEqual(self.remote.get('/admin/api/stats').status_code,401)
        self.login()
        report=self.remote.get('/admin/api/stats').json()
        self.assertEqual(report['totals']['views'],1)
        self.assertEqual(report['rows'][0]['ip'],'203.0.113.9')
        self.assertEqual(report['rows'][0]['referrer'],'example.test')

    def test_proxy_identity_and_local_admin_cannot_be_spoofed_remotely(self):
        headers={'Origin':ORIGIN,IP_HEADER:'198.51.100.4'}
        self.assertEqual(self.proxy.post('/collect',json=self.body,headers=headers).status_code,204)
        self.login()
        self.assertEqual(self.remote.get('/admin/api/stats').json()['rows'][0]['ip'],'198.51.100.4')
        local=TestClient(self.app,base_url='http://127.0.0.1:8011',client=('127.0.0.1',1234))
        self.assertEqual(local.get('/admin/api/stats').status_code,200)
        self.assertEqual(local.get('/admin/api/stats',headers={IP_HEADER:'198.51.100.4'}).status_code,401)
        self.assertEqual(local.get('/admin/api/stats',headers={'X-Forwarded-For':'127.0.0.1'}).status_code,401)
        local.close()

    def test_admin_session_cookie_and_csrf(self):
        self.assertEqual(self.remote.post('/admin/api/login',json={'token':self.secret},headers={'Origin':'https://evil.test'}).status_code,403)
        self.assertEqual(self.remote.post('/admin/api/login',json={'token':'wrong'},headers={'Origin':'https://traffic.test'}).status_code,401)
        response=self.login();self.assertEqual(response.status_code,200)
        cookie=response.headers['set-cookie'].lower()
        for flag in ['httponly','secure','samesite=strict','path=/admin']:
            self.assertIn(flag,cookie)
        self.assertEqual(self.remote.get('/admin/api/stats').status_code,200)
        self.remote.post('/admin/api/logout')
        self.assertEqual(self.remote.get('/admin/api/stats').status_code,401)

    def test_origin_body_limit_rate_and_retention(self):
        self.assertEqual(self.remote.post('/collect',json=self.body,headers={'Origin':'https://evil.test'}).status_code,403)
        self.assertEqual(self.remote.post('/collect',content='x'*3000,headers={'Origin':ORIGIN}).status_code,413)
        self.assertEqual(self.remote.post('/collect',json={**self.body,'path':'/other'},headers={'Origin':ORIGIN}).status_code,400)
        self.assertEqual(self.remote.post('/collect',json={'id':'bad'},headers={'Origin':ORIGIN}).status_code,400)
        now=int(time.time());store=self.app.state.store
        store.record(self.body,'192.0.2.1',now-RETENTION-100)
        store.record({**self.body,'id':'11234567-1234-1234-1234-123456789abc'},'192.0.2.2',now)
        with store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM visits').fetchone()[0],1)
        for _ in range(5):
            self.remote.post('/admin/api/login',json={'token':'bad'},headers={'Origin':'https://traffic.test'})
        self.assertEqual(self.login().status_code,429)
        self.assertLessEqual(len(store.limits),4096)

    def test_cors_and_admin_no_store(self):
        response=self.remote.options('/collect',headers={'Origin':ORIGIN,'Access-Control-Request-Method':'POST'})
        self.assertEqual(response.status_code,204)
        self.assertEqual(response.headers['access-control-allow-origin'],ORIGIN)
        self.assertNotIn('access-control-allow-credentials',response.headers)
        response=self.remote.get('/admin/api/stats')
        self.assertEqual(response.headers['cache-control'],'no-store')
        self.assertNotIn('access-control-allow-origin',response.headers)
        self.assertIn("frame-ancestors 'none'",response.headers['content-security-policy'])


if __name__=='__main__': unittest.main()
