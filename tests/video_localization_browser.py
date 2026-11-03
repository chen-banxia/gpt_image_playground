"""Verify live locale switching and panel positioning without paid API calls."""
from playwright.sync_api import sync_playwright, expect
import os, re, json

BASE = os.environ.get('VIDEO_TEST_BASE_URL', 'http://127.0.0.1:5174')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width':1440,'height':1000}, color_scheme='dark')
    page.route('https://**/*', lambda r:r.abort())
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(BASE+'/#/video', wait_until='networkidle')
    page.locator('header button').first.click()
    expect(page.get_by_role('heading',name='Video library',exact=True)).to_be_visible()
    expect(page.get_by_role('heading',name='Video creation',exact=True)).to_be_visible()
    composer=page.locator('[data-input-bar]')
    expect(composer.get_by_label('Model',exact=True)).to_contain_text('Hailuo H3')
    expect(composer.get_by_label('Items to fix')).to_contain_text('Describe the scene')
    composer.get_by_role('button',name='Change mode',exact=True).click()
    expect(composer.get_by_role('button',name='Close mode picker',exact=True)).to_have_attribute('aria-expanded','true')
    expect(composer.get_by_role('button',name='Advanced settings')).to_have_attribute('aria-expanded','false')
    expect(composer.get_by_role('button',name='Frames',exact=True)).to_be_focused()
    expect(composer.locator('#video-mode-picker')).to_be_in_viewport()
    composer.get_by_role('button',name='References',exact=True).click()
    expect(composer.locator('#video-mode-picker')).to_be_hidden()
    expect(composer.get_by_role('button',name='Change mode',exact=True)).to_be_focused()
    composer.get_by_role('button',name='Change mode',exact=True).click()
    composer.get_by_role('button',name='References',exact=True).press('Escape')
    expect(composer.locator('#video-mode-picker')).to_be_hidden()
    expect(composer.get_by_label('Items to fix')).to_contain_text('Add at least one reference')
    page.get_by_role('button',name='Batch actions',exact=True).click()
    expect(page.get_by_role('toolbar',name='Batch actions')).to_contain_text('0 records selected')
    # This context contains no user content, so Han text here indicates a missed translation.
    visible=page.locator('main').inner_text()+composer.inner_text()
    assert not re.search(r'[\u3400-\u9fff]',visible), visible
    page.get_by_role('button',name='Settings',exact=True).click()
    settings=page.get_by_role('region',name='Video API settings')
    expect(settings.get_by_label('Doubao video API key',exact=True)).to_be_visible()
    expect(settings.get_by_label('Hailuo video API key',exact=True)).to_be_visible()
    assert not re.search(r'[\u3400-\u9fff]',settings.inner_text())
    settings.get_by_label('New API gateway root URL').fill('https://example.com/v1')
    settings.get_by_role('button',name='Save video settings').click()
    expect(page.locator('[data-settings-feedback]').get_by_role('alert')).to_contain_text('without /v1')
    page.get_by_role('button',name='Close',exact=True).click()
    page.get_by_role('button',name='Manage groups',exact=True).click()
    expect(page.get_by_role('dialog',name='Manage groups')).to_be_visible()
    page.get_by_role('button',name='Close',exact=True).click()
    # Seed a fixed public fixture to exercise task details, model names and persisted notices.
    page.evaluate('''async()=>{
      const db=await import('/src/features/video/db.ts');
      await db.saveTask({id:'locale-fixture',modelId:'doubao-seedance-2-0-260128',keySlot:'doubaoVideo',credentialRevision:'test',gatewayBaseUrl:'https://example.com',proxy:false,prompt:'Test scene',inputMode:'frames',inputs:[],params:{duration:5,resolution:'720p',ratio:'16:9'},submissionState:'submitted',status:'failed',syncState:'paused',error:'请重新授权：该任务需要创建时对应的视频 Key',groupId:null,isFavorite:false,createdAt:1,updatedAt:1});
    }''')
    page.reload(wait_until='networkidle')
    card=page.locator('[data-video-card]').first
    expect(card).to_contain_text('Generation failed')
    expect(card).to_contain_text('Authorization required')
    assert not re.search(r'[\u3400-\u9fff]',card.inner_text())
    card.get_by_role('button',name='Details',exact=True).click()
    detail=page.get_by_role('dialog',name='Video details')
    expect(detail).to_be_visible()
    assert not re.search(r'[\u3400-\u9fff]',detail.inner_text())
    page.get_by_role('button',name='Close video details').click()
    positions={}
    for workspace in ['video','image']:
        page.locator(f'header nav a[href="#/{workspace}"]').click()
        if workspace=='video':
            expect(page.locator('main')).to_have_attribute('aria-label','Video library')
        else:
            expect(page.locator('[data-home-main]')).to_be_visible()
            page.evaluate('''async()=>{
              const db=await import('/src/lib/db.ts');
              await db.putTask({id:'image-locale-fixture',prompt:'Image fixture',params:{size:'auto',quality:'auto',output_format:'png',output_compression:null,moderation:'auto',n:1},inputImageIds:[],outputImages:[],status:'error',error:'Fixture',createdAt:1,finishedAt:1,elapsed:1});
            }''')
            page.reload(wait_until='networkidle')
            expect(page.locator('[data-gallery-items]')).to_be_visible()
        page.wait_for_function('document.querySelector("[data-input-bar]") !== null')
        page.wait_for_function('''()=>{const panel=document.querySelector('[data-input-bar]');const grid=document.querySelector('[data-workspace-toolbar]');return panel && grid && Math.abs(grid.getBoundingClientRect().top-panel.getBoundingClientRect().top)<2}''')
        metrics=page.evaluate('''()=>{const p=document.querySelector('[data-input-bar]').getBoundingClientRect(); const h=document.querySelector('header').getBoundingClientRect(); const grid=document.querySelector('[data-workspace-toolbar]');return {top:p.top,headerBottom:h.bottom,gridTop:grid?.getBoundingClientRect().top}}''')
        assert metrics['top'] >= metrics['headerBottom'],metrics
        if metrics['gridTop']:
            assert abs(metrics['gridTop']-metrics['top'])<2,metrics
        positions[workspace]=metrics
    page.locator('header nav a[href="#/video"]').click()
    expect(page.get_by_role('heading',name='Video library',exact=True)).to_be_visible()
    page.screenshot(path=os.path.join(os.environ['TEMP'],'video-localized-en-desktop.png'))
    for width in [320,390,768,1024,1440]:
        page.set_viewport_size({'width':width,'height':900})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),width
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path=os.path.join(os.environ['TEMP'],'video-localized-en-mobile.png'),full_page=True)
    page.locator('header button').first.click()
    expect(page.get_by_role('heading',name='视频作品',exact=True)).to_be_visible()
    expect(page.get_by_role('heading',name='视频创作',exact=True)).to_be_visible()
    expect(page.locator('[data-video-card]').first).to_contain_text('生成失败')
    assert not errors,errors
    print(json.dumps({'localeRoundTrip':True,'formSettingsValidationDetails':True,'storedMessages':True,'positions':positions,'responsiveWidths':[320,390,768,1024,1440],'pageErrors':errors}))
    browser.close()
