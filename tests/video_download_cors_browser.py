"""CORS download fallback to same-origin proxy, ZIP, and absent-proxy UI."""
from playwright.sync_api import sync_playwright, expect
import json, os, io, zipfile
from pathlib import Path

BASE=os.environ.get('VIDEO_TEST_BASE_URL','http://127.0.0.1:5174')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True)
    page.set_default_timeout(10000)
    page.route('https://**/*',lambda r:r.abort())
    page.goto(BASE+'/#/video',wait_until='networkidle')
    signed='https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/doubao-seedance-2-0/result.mp4?X-Tos-Credential=test%2Fcredential&X-Tos-Signature=test-signature'
    proxy_requests=[]
    def proxy(route):
        proxy_requests.append({'url':route.request.url,'headers':route.request.headers})
        route.fulfill(body=b'\x00\x00\x00\x18ftypmp42'+b'test-video'*50,content_type='video/mp4',headers={'X-Video-Download-Proxy':'1'})
    page.route('**/video-download-proxy/**',proxy)
    page.evaluate('''async(url)=>{const db=await import('/src/features/video/db.ts');await db.saveTask({id:'cors-video',modelId:'doubao-seedance-2-0-260128',keySlot:'doubaoVideo',credentialRevision:'test',gatewayBaseUrl:'https://gateway.example',proxy:false,prompt:'CORS download fixture',inputMode:'frames',inputs:[],params:{duration:5,resolution:'480p',ratio:'16:9'},submissionState:'submitted',status:'succeeded',syncState:'paused',videoUrl:url,groupId:null,isFavorite:false,createdAt:1,updatedAt:1})}''',signed)
    page.reload(wait_until='networkidle')
    card=page.locator('[data-video-card="cors-video"]')
    with page.expect_download() as result:card.get_by_role('button',name='下载',exact=True).click()
    assert Path(result.value.path()).read_bytes().startswith(b'\x00\x00\x00\x18ftypmp42')
    expect(card).to_contain_text('已下载')
    assert len(proxy_requests)==1
    assert proxy_requests[0]['url']==BASE+'/video-download-proxy/'+signed.split('https://',1)[1]
    assert 'authorization' not in proxy_requests[0]['headers']
    page.get_by_role('region',name='视频下载队列').get_by_role('button',name='关闭',exact=True).click()
    page.get_by_role('button',name='批量操作',exact=True).click()
    toolbar=page.locator('[data-workspace-batch]')
    toolbar.get_by_role('button',name='全选本页',exact=True).click()
    toolbar.get_by_role('button',name='下载',exact=False).click()
    with page.expect_download() as result:toolbar.get_by_role('button',name='打包 ZIP',exact=True).click()
    with zipfile.ZipFile(result.value.path()) as z:assert len(z.namelist())==1 and z.read(z.namelist()[0]).startswith(b'\x00\x00\x00\x18ftypmp42')
    page.get_by_role('region',name='视频下载队列').get_by_role('button',name='关闭',exact=True).click()
    # Static-host SPA fallback must not be saved as a video or repeatedly re-fetched.
    page.unroute('**/video-download-proxy/**',proxy)
    attempts=[]
    def absent(route):attempts.append(route.request.url);route.fulfill(body='<html>SPA</html>',content_type='text/html')
    page.route('**/video-download-proxy/**',absent)
    page.evaluate('''async()=>{const db=await import('/src/features/video/db.ts');await db.patchTasks(['cors-video'],{downloadedAt:undefined,downloadSource:undefined})}''')
    page.reload(wait_until='networkidle')
    card.get_by_role('button',name='下载',exact=True).click()
    queue=page.get_by_role('region',name='视频下载队列')
    expect(queue).to_contain_text('文件下载代理尚未部署')
    expect(queue.get_by_role('link',name='打开原视频另存为')).to_have_attribute('href',signed)
    expect(card).to_contain_text('未下载')
    assert len(attempts)==1
    page.locator('header button').first.click()
    queue=page.get_by_role('region',name='Video download queue')
    expect(queue.get_by_role('link',name='Open original to save')).to_be_visible()
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    print(json.dumps({'singleDownloadViaProxy':True,'zipViaProxy':True,'signedQueryPreserved':True,'noGatewayKeyOnCDN':True,'missingProxyFallback':True,'noFalseDownloadBadge':True,'noRepeatedCorsFetch':True,'englishMobile':True}))
    browser.close()
