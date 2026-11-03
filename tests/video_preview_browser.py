"""Automatic paused card previews, including cross-origin playback and lazy cleanup."""
from playwright.sync_api import sync_playwright, expect
import base64, json, os

BASE=os.environ.get('VIDEO_TEST_BASE_URL','http://127.0.0.1:5174')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1000},color_scheme='dark')
    errors=[]; requests=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('https://**/*',lambda r:r.abort())
    page.goto(BASE+'/#/video',wait_until='networkidle')
    media=base64.b64decode(page.evaluate('''async()=>{
      const c=document.createElement('canvas');c.width=640;c.height=360;const ctx=c.getContext('2d');
      const paint=()=>{ctx.fillStyle='#78c5e2';ctx.fillRect(0,0,640,360);ctx.fillStyle='#f8d37a';ctx.beginPath();ctx.arc(490,90,44,0,Math.PI*2);ctx.fill();ctx.fillStyle='#237aab';ctx.fillRect(0,210,640,150);ctx.fillStyle='#fff';ctx.font='36px sans-serif';ctx.fillText('Automatic video preview',50,160)};
      paint();const stream=c.captureStream(12),rec=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks=[];
      return await new Promise(resolve=>{rec.ondataavailable=e=>chunks.push(e.data);rec.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());resolve(btoa(String.fromCharCode(...bytes)))};rec.start();const timer=setInterval(paint,50);setTimeout(()=>{clearInterval(timer);rec.stop()},800)});
    }'''))
    def media_route(route):
        requests.append({'url':route.request.url,'headers':route.request.headers})
        if 'broken' in route.request.url:route.fulfill(status=403,body='Expired');return
        # Deliberately omit CORS: displaying a paused frame must not require canvas access.
        route.fulfill(body=media,content_type='video/webm')
    page.route('https://preview.example/**',media_route)
    page.evaluate('''async()=>{
      const db=await import('/src/features/video/db.ts');
      for(let i=0;i<18;i++)await db.saveTask({id:'preview-'+i,modelId:'MiniMax-H3',keySlot:'hailuoVideo',credentialRevision:'test',gatewayBaseUrl:'https://example.com',proxy:false,prompt:'Preview fixture '+i,inputMode:'frames',inputs:[],params:{duration:5,resolution:'768P',ratio:'16:9'},submissionState:'submitted',status:'succeeded',syncState:'paused',videoUrl:'https://preview.example/'+(i===1?'broken':i)+'.webm',groupId:null,isFavorite:false,createdAt:100-i,updatedAt:1});
    }''')
    page.reload(wait_until='networkidle')
    first=page.locator('[data-video-card="preview-0"]')
    expect(first.locator('[data-video-preview]')).to_have_attribute('data-preview-state','ready')
    assert first.locator('video').evaluate('(v)=>v.paused && v.muted && v.readyState>=2 && v.videoWidth===640')
    expect(first).to_contain_text('未下载')
    broken=page.locator('[data-video-card="preview-1"]')
    expect(broken.locator('[data-video-preview]')).to_have_attribute('data-preview-state','failed')
    expect(broken).to_contain_text('预览暂不可用')
    expect(broken).to_contain_text('已生成')
    assert not any('/14.webm' in r['url'] for r in requests),requests
    assert all('authorization' not in r['headers'] for r in requests)
    page.screenshot(path=os.path.join(os.environ['TEMP'],'video-card-preview.png'))
    page.get_by_role('button',name='批量操作',exact=True).click()
    first.get_by_role('checkbox').check()
    expect(page.locator('[data-workspace-batch]')).to_contain_text('已选 1 条记录')
    page.locator('[data-workspace-batch]').get_by_role('button',name='退出批量',exact=True).click()
    first.get_by_role('button',name='播放视频 Preview fixture 0',exact=True).click()
    detail=page.get_by_role('dialog',name='视频详情')
    detail.locator('video').evaluate('(v)=>v.play()')
    expect(detail.locator('video')).to_be_visible()
    assert first.locator('video').evaluate('(v)=>v.paused')
    page.get_by_role('button',name='关闭视频详情').click()
    page.locator('[data-video-card="preview-14"]').scroll_into_view_if_needed()
    expect(first.locator('[data-video-preview]')).to_have_attribute('data-preview-state','idle')
    assert first.locator('video').get_attribute('src') is None
    expect(page.locator('[data-video-card="preview-14"] [data-video-preview]')).to_have_attribute('data-preview-state','ready')
    page.get_by_role('button',name='下一页',exact=True).click()
    expect(page.locator('[data-video-card]')).to_have_count(3)
    page.locator('[data-video-card]').first.scroll_into_view_if_needed()
    expect(page.locator('[data-video-card]').first.locator('[data-video-preview]')).to_have_attribute('data-preview-state','ready')
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    print(json.dumps({'automaticFrame':True,'pausedMuted':True,'crossOriginWithoutCors':True,'lazyLoading':True,'releaseOffscreen':True,'errorFallback':True,'downloadBadgeUnchanged':True,'selectionAndPlayback':True,'pagination':True,'mobileNoOverflow':True,'pageErrors':errors}))
    browser.close()
