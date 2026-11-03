"""Shared image/video toolbar layout and filtering regression, without external requests."""
from playwright.sync_api import sync_playwright, expect
import json, os, base64, io
from PIL import Image

BASE=os.environ.get('VIDEO_TEST_BASE_URL','http://127.0.0.1:5174')
png=io.BytesIO()
Image.new('RGB',(512,512),'#3b729e').save(png,format='PNG')
data_url='data:image/png;base64,'+base64.b64encode(png.getvalue()).decode()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1000},color_scheme='dark',accept_downloads=True)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('https://**/*',lambda r:r.abort())
    page.goto(BASE+'/#/image',wait_until='networkidle')
    # All fixtures are isolated in this browser context.
    page.evaluate('''async (dataUrl)=>{
      const imageDb=await import('/src/lib/db.ts'); const videoDb=await import('/src/features/video/db.ts');
      const settings=JSON.parse(localStorage.getItem('gpt-image-playground'));
      settings.state.groups=[{id:'group-a',name:'Campaign'},{id:'group-b',name:'Archive'}];
      settings.state.downloadedImages={'img-a':1};
      localStorage.setItem('gpt-image-playground',JSON.stringify(settings));
      const params={size:'auto',quality:'auto',output_format:'png',output_compression:null,moderation:'auto',n:1};
      for(const id of ['img-a','img-b','img-c']) await imageDb.putImage({id,dataUrl,source:'generated'});
      for(let i=0;i<18;i++){
        await imageDb.putTask({id:'image-'+i,groupId:'group-a',prompt:'Fixture '+i,params,inputImageIds:[],outputImages:i===0?[]:i===1?['img-a','img-b']:i===2?['img-a']:['img-c'],status:i===0?'running':'done',apiModel:i===0?undefined:i%2?'model-a':'model-b',createdAt:100-i,finishedAt:100,elapsed:0,error:null});
        await videoDb.saveTask({id:'video-'+i,modelId:'doubao-seedance-2-0-260128',keySlot:'doubaoVideo',credentialRevision:'test',gatewayBaseUrl:'https://fixture.example',proxy:false,prompt:'Fixture '+i,inputMode:'frames',inputs:[],params:{duration:5,resolution:'720p',ratio:'16:9'},submissionState:'submitted',status:'succeeded',syncState:'paused',videoUrl:'https://fixture.example/'+i+'.mp4',groupId:'group-a',isFavorite:false,downloadedAt:i===2?1:undefined,createdAt:100-i,updatedAt:100});
      }
    }''',data_url)
    page.reload(wait_until='networkidle')
    toolbar=page.locator('[data-workspace-toolbar]')
    expect(page.get_by_role('heading',name='图片作品')).to_be_visible()
    expect(page.locator('.task-card-wrapper')).to_have_count(15)
    toolbar.locator('[data-filter=download]').select_option('partial')
    expect(page.locator('.task-card-wrapper')).to_have_count(1)
    expect(page.locator('.task-card-wrapper')).to_contain_text('Fixture 1')
    toolbar.locator('[data-filter=download]').select_option('downloaded')
    expect(page.locator('.task-card-wrapper')).to_have_count(1)
    toolbar.locator('[data-filter=download]').select_option('not_downloaded')
    expect(page.locator('.task-card-wrapper')).to_have_count(15)
    toolbar.locator('[data-filter=download]').select_option('all')
    toolbar.locator('[data-filter=model]').select_option('model-a')
    expect(page.locator('.task-card-wrapper')).to_have_count(9)
    toolbar.locator('[data-filter=query]').fill('Fixture 1')
    expect(page.locator('.task-card-wrapper')).to_have_count(5)
    toolbar.get_by_role('button',name='清空搜索').click()
    toolbar.locator('[data-filter=model]').select_option('all')
    # Shared jump form handles invalid entries and both click/Enter submission.
    pagination=page.locator('[data-workspace-pagination]')
    pagination.get_by_label('跳至页码').fill('0')
    expect(pagination.get_by_role('button',name='跳转',exact=True)).to_be_disabled()
    pagination.get_by_label('跳至页码').fill('2')
    pagination.get_by_role('button',name='跳转',exact=True).click()
    expect(page.locator('.task-card-wrapper')).to_have_count(3)
    pagination.get_by_label('跳至页码').fill('1')
    pagination.get_by_label('跳至页码').press('Enter')
    expect(page.locator('.task-card-wrapper')).to_have_count(15)
    toolbar.get_by_role('button',name='批量操作',exact=True).click()
    batch=page.locator('[data-workspace-batch]')
    batch.get_by_role('button',name='全选本页').click()
    expect(batch).to_contain_text('已选 15 条记录')
    batch.get_by_role('button',name='收藏',exact=True).click()
    expect(batch.get_by_role('button',name='取消收藏',exact=True)).to_be_visible()
    batch.get_by_label('移至分组',exact=True).select_option('group-b')
    expect(batch).to_contain_text('已选 0 条记录')
    batch.get_by_role('button',name='全选本页').click()
    batch.get_by_role('button',name='下载',exact=False).click()
    batch.get_by_label('仅下载未下载文件').check()
    with page.expect_download() as downloaded:
        batch.get_by_role('button',name='逐项下载',exact=True).click()
    assert downloaded.value.suggested_filename.endswith('.png')
    # Switch away while the global queue finishes; no selection leaks on return.
    page.locator('header nav a[href="#/video"]').click()
    expect(page.get_by_role('heading',name='视频作品')).to_be_visible()
    expect(page.locator('[data-workspace-batch]')).to_have_count(0)
    downloads=page.get_by_role('region',name='图片下载队列')
    expect(downloads.get_by_role('button',name='关闭',exact=True)).to_be_visible()
    downloads.get_by_role('button',name='关闭',exact=True).click()
    # Same data-filter sequence and identical toolbar geometry at all breakpoints.
    geometry={}
    for language in ['zh','en']:
        if language=='en':page.locator('header button').first.click()
        for width in [320,390,768,1024,1440,1700]:
            page.set_viewport_size({'width':width,'height':1000})
            layouts=[]
            for workspace in ['image','video']:
                page.locator(f'header nav a[href="#/{workspace}"]').click()
                expect(page.locator('main')).to_have_attribute('aria-label','Video library' if language=='en' else '视频作品') if workspace=='video' else expect(page.locator('[data-home-main]')).to_be_visible()
                toolbar=page.locator('[data-workspace-toolbar]')
                header=page.locator('[data-creation-panel-header]')
                header.get_by_role('button',name='Collapse panel' if language=='en' else '收起面板',exact=True).click()
                expect(header.get_by_role('button',name='Expand panel' if language=='en' else '展开面板',exact=True)).to_be_visible()
                header.get_by_role('button',name='Expand panel' if language=='en' else '展开面板',exact=True).click()
                assert toolbar.locator('[data-filter]').evaluate_all('(els)=>els.map(e=>e.dataset.filter)')==['group','favorite','status','model','download','query']
                layouts.append(toolbar.bounding_box()['height'])
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),(width,workspace,language)
                batchName='Batch actions' if language=='en' else '批量操作'
                toolbar.get_by_role('button',name=batchName,exact=True).click()
                expect(page.locator('[data-workspace-batch]')).to_be_visible()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),('batch',width,workspace,language)
                page.locator('[data-workspace-batch]').get_by_role('button',name='Exit selection' if language=='en' else '退出批量',exact=True).click()
                if width==1440 and language=='zh':page.screenshot(path=os.path.join(os.environ['TEMP'],f'unified-{workspace}-toolbar.png'))
            assert abs(layouts[0]-layouts[1])<2,(width,language,layouts)
            geometry[f'{language}-{width}']=layouts
    # Video's partial download option is present, but a single-output task never matches it.
    page.locator('[data-filter=download]').select_option('partial')
    expect(page.locator('[data-video-card]')).to_have_count(0)
    expect(page.locator('[data-workspace-pagination]')).to_contain_text('0–0 of 0')
    page.locator('header nav a[href="#/image"]').click()
    expect(page.locator('[data-home-main]')).to_be_visible()
    page.locator('[data-filter=query]').fill('no-such-record')
    expect(page.locator('.task-card-wrapper')).to_have_count(0)
    expect(page.locator('[data-workspace-pagination]')).to_contain_text('0–0 of 0')
    assert not errors,errors
    print(json.dumps({'imageFilters':True,'jumpValidation':True,'downloadQueueSurvivesNavigation':True,'selectionIsolation':True,'commonGeometry':geometry,'pageErrors':errors}))
    browser.close()
