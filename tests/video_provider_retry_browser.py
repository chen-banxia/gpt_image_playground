"""Provider route editing, H3 native responses and quick retry with an untouched draft."""
from playwright.sync_api import sync_playwright, expect
import os, json

BASE=os.environ.get('VIDEO_TEST_BASE_URL','http://127.0.0.1:5174')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    context=browser.new_context(viewport={'width':1440,'height':1000},color_scheme='dark')
    page=context.new_page()
    page.set_default_timeout(10000)
    errors=[]; calls=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    context.route('https://**/*',lambda r:r.abort())
    def gateway(route):
        req=route.request
        headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'POST,GET,OPTIONS'}
        if req.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
        calls.append({'url':req.url,'method':req.method,'auth':req.headers.get('authorization'),'body':req.post_data_json if req.method=='POST' else None})
        route.fulfill(headers=headers,json={'task_id':'retry-created'} if req.method=='POST' else {'task':{'id':'retry-created','status':'succeeded','content':{'url':'https://cdn.example/retry.mp4'}}})
    context.route('https://gateway.example/**',gateway)
    page.goto(BASE+'/#/video',wait_until='networkidle')
    page.evaluate('''async()=>{
      const db=await import('/src/features/video/db.ts');
      await db.saveDraft({id:'main',modelId:'doubao-seedance-2-0-260128',inputMode:'frames',prompt:'Keep my current draft',frames:[],references:[],params:{duration:10,resolution:'720p',ratio:'16:9'},groupId:null});
      await db.saveTask({id:'failed-h3',modelId:'MiniMax-H3',keySlot:'hailuoVideo',credentialRevision:'old',gatewayBaseUrl:'https://gateway.example',proxy:false,prompt:'Original H3 description',inputMode:'frames',inputs:[],params:{duration:5,resolution:'768P',ratio:'16:9'},submissionState:'rejected',status:'failed',syncState:'paused',error:'model "MiniMax-H3" is not served by this plugin',groupId:null,isFavorite:false,createdAt:1,updatedAt:1});
    }''')
    page.reload(wait_until='networkidle')
    old=page.locator('[data-video-card="failed-h3"]')
    expect(old.get_by_role('button',name='重试',exact=True)).to_be_visible()
    old.get_by_role('button',name='检查视频配置',exact=True).click()
    settings=page.get_by_role('region',name='视频接口设置')
    expect(settings.get_by_label('H3 创建任务路径')).to_have_value('/hailuo/v2/video_generation')
    expect(settings.get_by_label('H3 查询任务路径')).to_have_value('/hailuo/v2/query/video_generation/{task_id}')
    settings.get_by_label('New API 网关根地址').fill('https://gateway.example')
    settings.get_by_label('海螺视频 API Key',exact=True).fill('h3-current-key')
    settings.get_by_role('checkbox',name='在当前浏览器记住此 Key').nth(1).check()
    # Invalid paths are refused; relative aliases can be saved and later restored.
    settings.get_by_label('H3 创建任务路径').fill('https://other.example/create')
    settings.get_by_role('button',name='保存视频配置').click()
    expect(settings.get_by_role('status')).to_contain_text('接口路径')
    settings.get_by_label('H3 创建任务路径').fill('/hailuo/v1/video_generation')
    settings.get_by_label('H3 查询任务路径').fill('/hailuo/v1/query/video_generation/{task_id}')
    settings.get_by_role('button',name='保存视频配置').click()
    page.get_by_role('button',name='关闭',exact=True).click()
    page.reload(wait_until='networkidle')
    page.get_by_role('button',name='设置',exact=True).click()
    settings=page.get_by_role('region',name='视频接口设置')
    expect(settings.get_by_label('H3 创建任务路径')).to_have_value('/hailuo/v1/video_generation')
    settings.get_by_role('button',name='恢复服务默认路径').nth(1).click()
    settings.get_by_role('button',name='保存视频配置').click()
    settings.get_by_label('H3 查询任务路径').scroll_into_view_if_needed()
    page.screenshot(path=os.path.join(os.environ['TEMP'],'video-provider-settings.png'))
    page.get_by_role('button',name='关闭',exact=True).click()
    old.get_by_role('button',name='重试',exact=True).click()
    expect(page.locator('[data-video-card]')).to_have_count(2)
    expect(page.locator('[data-video-card]').first).to_contain_text('已生成')
    expect(old).to_contain_text('生成失败')
    expect(page.locator('[data-input-bar] textarea')).to_have_value('Keep my current draft')
    expect(page.locator('[data-input-bar]').get_by_label('模型',exact=True)).to_have_value('doubao-seedance-2-0-260128')
    posts=[c for c in calls if c['method']=='POST']
    assert len(posts)==1,posts
    assert posts[0]['url']=='https://gateway.example/hailuo/v2/video_generation'
    assert posts[0]['auth']=='Bearer h3-current-key'
    assert posts[0]['body']['model']=='MiniMax-H3'
    assert posts[0]['body']['content'][0]['text']=='Original H3 description'
    assert posts[0]['body']['duration']==5
    assert any(c['url']=='https://gateway.example/hailuo/v2/query/video_generation/retry-created' for c in calls)
    page.screenshot(path=os.path.join(os.environ['TEMP'],'video-quick-retry.png'))
    page.locator('header button').first.click()
    expect(old.get_by_role('button',name='Retry',exact=True)).to_be_visible()
    old.get_by_role('button',name='Check video settings',exact=True).click()
    settings=page.get_by_role('region',name='Video API settings')
    expect(settings.get_by_label('H3 Create task path')).to_have_value('/hailuo/v2/video_generation')
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    print(json.dumps({'providerSettings':True,'invalidPathRejected':True,'customPathsPersist':True,'h3NativeRouteAndResponse':True,'quickRetryPreservesDraft':True,'originalFailureKept':True,'englishAndMobile':True,'pageErrors':errors}))
    browser.close()
