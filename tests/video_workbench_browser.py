from playwright.sync_api import sync_playwright, expect
from pathlib import Path
import json, os, io, zipfile
from PIL import Image

BASE = os.environ.get('VIDEO_TEST_BASE_URL', 'http://127.0.0.1:5174')
POSTS = []
queries = {}
png = io.BytesIO()
Image.new('RGB', (640, 360), '#3875a4').save(png, format='PNG')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width':1440,'height':1000}, color_scheme='dark', accept_downloads=True)
    page = context.new_page()
    page.set_default_timeout(10000)
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    def gateway(route):
        req=route.request
        headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'POST,GET,OPTIONS'}
        if req.method=='OPTIONS': route.fulfill(status=204,headers=headers); return
        if req.method=='POST':
            body=req.post_data_json
            POSTS.append({'body':body,'auth':req.headers.get('authorization'),'url':req.url})
            route.fulfill(json={('task_id' if '/hailuo/' in req.url else 'id'):f'task-{len(POSTS)}'},headers=headers)
        else:
            task=req.url.rsplit('/',1)[-1]
            queries[task]=queries.get(task,0)+1
            snapshot={'id':task,'status':'succeeded','content':{('url' if '/hailuo/' in req.url else 'video_url'):f'https://cdn.example/{task}.mp4'},'duration':5,'resolution':'720p'}
            route.fulfill(json={'task':snapshot} if '/hailuo/' in req.url else snapshot,headers=headers)
    context.route('https://**/*',lambda r:r.abort())
    context.route('https://gateway.example/**', gateway)
    media_bytes = b''
    cdn_headers = []
    def serve_media(route):
        cdn_headers.append(route.request.headers)
        route.fulfill(body=media_bytes,content_type='video/webm',headers={'Access-Control-Allow-Origin':'*'})
    context.route('https://cdn.example/**', serve_media)
    page.goto(BASE+'/#/video',wait_until='networkidle')
    expect(page.get_by_role('heading',name='视频作品',exact=True)).to_be_visible()
    # 在浏览器内生成可播放的短视频，整个测试不访问收费接口。
    import base64
    media_bytes=base64.b64decode(page.evaluate('''async () => {
      const canvas=document.createElement('canvas'); canvas.width=320; canvas.height=180;
      const ctx=canvas.getContext('2d'); ctx.fillStyle='#3875a4'; ctx.fillRect(0,0,320,180);
      const stream=canvas.captureStream(12);
      const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});
      const chunks=[];
      return await new Promise(resolve=>{
        recorder.ondataavailable=e=>chunks.push(e.data);
        recorder.onstop=async()=>{ const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer()); stream.getTracks().forEach(t=>t.stop()); resolve(btoa(String.fromCharCode(...bytes))); };
        recorder.start();
        const timer=setInterval(()=>{ctx.fillStyle=`hsl(${Date.now()%360} 50% 40%)`;ctx.fillRect(0,0,320,180)},50);
        setTimeout(()=>{clearInterval(timer);recorder.stop()},800);
      });
    }'''))
    page.get_by_role('button',name='设置',exact=True).click()
    panel=page.get_by_role('region',name='视频接口设置')
    panel.get_by_label('New API 网关根地址').fill('https://gateway.example/sub')
    panel.get_by_label('豆包视频 API Key',exact=True).fill('doubao-e2e-key')
    panel.get_by_label('海螺视频 API Key',exact=True).fill('hailuo-e2e-key')
    panel.get_by_role('checkbox',name='在当前浏览器记住此 Key').nth(0).check()
    panel.get_by_role('checkbox',name='在当前浏览器记住此 Key').nth(1).check()
    panel.get_by_role('button',name='保存视频配置').click()
    page.get_by_role('button',name='关闭',exact=True).click()
    page.get_by_role('button',name='管理分组',exact=True).click()
    page.get_by_label('分组名称').fill('视频测试分组')
    page.get_by_role('button',name='新建',exact=True).click()
    page.get_by_role('button',name='关闭',exact=True).click()
    composer=page.get_by_role('complementary',name='视频创作')
    composer.get_by_role('textbox',name='描述画面、动作与镜头').fill('测试场景，海岸缓慢推进')
    composer.get_by_label('新视频归入').select_option(label='视频测试分组')
    composer.get_by_role('button',name='生成视频 →',exact=True).click()
    expect(page.locator('[data-video-card]')).to_have_count(1)
    expect(page.locator('[data-video-card]').first).to_contain_text('已生成')
    assert POSTS[0]['auth']=='Bearer doubao-e2e-key'
    assert POSTS[0]['url']=='https://gateway.example/sub/doubao/api/v3/contents/generations/tasks'
    assert len(POSTS[0]['body']['content'])==1
    # 首尾帧上传与 2.5 参数自动映射
    composer.get_by_label('模型',exact=True).select_option('doubao-seedance-2-5-260628')
    composer.get_by_role('button',name='＋ 添加',exact=True).nth(0).click()
    composer.locator('input[type=file]').set_input_files({'name':'start.png','mimeType':'image/png','buffer':png.getvalue()})
    expect(composer.get_by_text('start.png',exact=True)).to_be_visible()
    composer.get_by_role('button',name='＋ 添加',exact=True).click()
    composer.locator('input[type=file]').set_input_files({'name':'end.png','mimeType':'image/png','buffer':png.getvalue()})
    expect(composer.get_by_text('end.png',exact=True)).to_be_visible()
    expect(composer.get_by_label('画面比例')).to_have_value('adaptive')
    composer.get_by_role('button',name='生成视频 →',exact=True).click()
    expect(page.locator('[data-video-card]')).to_have_count(2)
    expect(page.locator('[data-video-card]').first).to_contain_text('已生成')
    assert [i.get('role') for i in POSTS[1]['body']['content'][1:]]==['first_frame','last_frame']
    assert POSTS[1]['body']['ratio']=='adaptive'
    # 模式切换保留草稿，海螺同路由但使用不同 Key。
    composer.get_by_role('button',name='更改方式',exact=True).click()
    page.once('dialog',lambda d:d.accept())
    composer.get_by_role('button',name='全能参考',exact=True).click()
    composer.get_by_label('模型',exact=True).select_option('MiniMax-H3')
    composer.get_by_label('分辨率').select_option('768P')
    composer.get_by_role('button',name='生成视频 →',exact=True).click()
    expect(page.locator('[data-video-card]')).to_have_count(3)
    expect(page.locator('[data-video-card]').first).to_contain_text('已生成')
    assert POSTS[2]['auth']=='Bearer hailuo-e2e-key'
    assert POSTS[2]['url']=='https://gateway.example/sub/hailuo/v2/video_generation'
    assert all(i['role']=='reference_image' for i in POSTS[2]['body']['content'][1:])
    assert POSTS[2]['body']['resolution']=='768P'
    page.reload(wait_until='networkidle')
    composer=page.get_by_role('complementary',name='视频创作')
    expect(composer.get_by_label('模型',exact=True)).to_have_value('MiniMax-H3')
    expect(composer.get_by_text('全能参考模式',exact=True)).to_be_visible()
    expect(page.locator('[data-video-card]')).to_have_count(3)
    # 下载、ZIP、筛选和收藏
    with page.expect_download() as dl:
        page.locator('[data-video-card]').first.get_by_role('button',name='下载',exact=True).click()
    assert dl.value.suggested_filename.endswith('.webm')
    expect(page.locator('[data-video-card]').first).to_contain_text('已下载')
    page.get_by_label('筛选下载状态').select_option('downloaded')
    expect(page.locator('[data-video-card]')).to_have_count(1)
    page.get_by_label('筛选下载状态').select_option('all')
    page.get_by_role('button',name='批量操作',exact=True).click()
    toolbar=page.get_by_role('toolbar',name='批量操作')
    toolbar.get_by_role('button',name='全选本页').click()
    expect(toolbar).to_contain_text('已选 3 条')
    toolbar.get_by_role('button',name='收藏',exact=True).click()
    toolbar.get_by_role('button',name='下载',exact=False).click()
    with page.expect_download() as dl:
        toolbar.get_by_role('button',name='打包 ZIP',exact=True).click()
    zipped=Path(dl.value.path()).read_bytes()
    with zipfile.ZipFile(io.BytesIO(zipped)) as z: assert len(z.namelist())==3
    expect(page.locator('[data-video-card]').filter(has_text='已下载')).to_have_count(3)
    page.get_by_role('region',name='视频下载队列').get_by_role('button',name='关闭',exact=True).click()
    page.screenshot(path=os.path.join(os.environ['TEMP'],'video-e2e-desktop.png'))
    # 数据库存储隔离，导出不含 Key。
    databases=page.evaluate('async () => (await indexedDB.databases()).map(d => d.name)')
    assert 'gpt-video-playground' in databases and 'gpt-image-playground' in databases
    page.get_by_role('button',name='设置',exact=True).click()
    panel=page.get_by_role('region',name='视频接口设置')
    with page.expect_download() as dl: panel.get_by_role('button',name='导出视频历史',exact=True).click()
    backup=Path(dl.value.path()).read_text(encoding='utf-8')
    assert 'doubao-e2e-key' not in backup and 'hailuo-e2e-key' not in backup
    assert len(json.loads(backup)['tasks'])==3
    page.get_by_role('button',name='关闭',exact=True).click()
    # 原生播放器确实能加载与播放，同时 CDN 请求不携带网关令牌。
    page.locator('[data-video-card]').first.get_by_role('button',name='详情',exact=True).click()
    video=page.get_by_role('dialog',name='视频详情').locator('video')
    video.evaluate('(v)=>v.play()')
    expect(video).to_have_js_property('paused',False)
    page.get_by_role('button',name='关闭视频详情').click()
    assert all('authorization' not in h for h in cdn_headers)
    # 图转视频复制素材后，清空图片库仍可保留视频输入。
    page.get_by_role('link',name='图片工作台',exact=True).click()
    page.evaluate('''async (dataUrl) => {
      const store=await import('/src/store.ts'); const db=await import('/src/lib/db.ts');
      await db.putImage({id:'e2e-source-image',dataUrl,source:'generated'});
      const task={id:'e2e-image-task',prompt:'Image source',params:store.useStore.getState().params,inputImageIds:[],outputImages:['e2e-source-image'],status:'done',error:null,createdAt:Date.now(),finishedAt:Date.now(),elapsed:10};
      await db.putTask(task); store.useStore.getState().setTasks([task]);
    }''','data:image/png;base64,'+base64.b64encode(png.getvalue()).decode())
    page.reload(wait_until='networkidle')
    page.get_by_role('button',name='生成视频',exact=True).click()
    expect(page.get_by_role('complementary',name='视频创作').get_by_text('图片工作台素材.png',exact=True)).to_be_visible()
    page.evaluate('''async () => { await (await import('/src/store.ts')).clearImageWorkspaceData() }''')
    page.reload(wait_until='networkidle')
    expect(page.get_by_role('complementary',name='视频创作').get_by_text('图片工作台素材.png',exact=True)).to_be_visible()
    # 注入额外脱敏任务，检查本页 15 条和分页选择隔离。
    page.evaluate('''async () => {
      const db=await import('/src/features/video/db.ts'); const store=await import('/src/features/video/store.ts');
      const original=(await db.readAll('videoTasks'))[0];
      for(let i=0;i<15;i++) await db.saveTask({...original,id:'page-fixture-'+i,prompt:'Page fixture '+i,createdAt:Date.now()+i});
      await store.refreshVideo();
    }''')
    page.reload(wait_until='networkidle')
    expect(page.locator('[data-video-card]')).to_have_count(15)
    page.get_by_role('button',name='批量操作',exact=True).click()
    toolbar=page.get_by_role('toolbar',name='批量操作')
    toolbar.get_by_role('button',name='全选本页').click()
    expect(toolbar).to_contain_text('已选 15 条')
    page.get_by_role('button',name='下一页',exact=True).click()
    expect(page.locator('[data-video-card]')).to_have_count(3)
    expect(toolbar).to_contain_text('已选 0 条')
    # 批量删除只影响选择的本页，不取消模型任务。
    toolbar.get_by_role('button',name='全选本页').click()
    toolbar.get_by_role('button',name='删除记录',exact=True).click()
    page.get_by_role('button',name='确认删除',exact=True).click()
    expect(page.locator('[data-video-card]')).to_have_count(15)
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path=os.path.join(os.environ['TEMP'],'video-e2e-mobile.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.get_by_role('link',name='图片工作台',exact=True).click()
    expect(page.get_by_role('complementary',name='画图设置')).to_be_visible()
    assert not errors, errors
    print(json.dumps({'created':len(POSTS),'keyRouting':True,'frameAndReferenceRoles':True,'draftReload':True,'zipFiles':3,'downloadFilter':True,'databaseIsolation':True,'exportNoSecrets':True,'videoPlayback':True,'cdnNoCredentials':True,'imageCopyIsolation':True,'pageSize15':True,'batchDelete':True,'mobileNoOverflow':True,'pageErrors':errors}))
    browser.close()
