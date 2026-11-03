"""Submission timeout settings and interrupted-submit feedback; mocked gateway only."""
from playwright.sync_api import sync_playwright, expect
import json, os, time

BASE=os.environ.get('VIDEO_TEST_BASE_URL','http://127.0.0.1:5174')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    context=browser.new_context(viewport={'width':1280,'height':900})
    page=context.new_page()
    page.set_default_timeout(10000)
    errors=[];posts=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    context.route('https://**/*',lambda r:r.abort())
    def gateway(route):
        headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'POST,GET,OPTIONS'}
        if route.request.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
        posts.append(route.request.method)
        time.sleep(1.5)
        try:route.fulfill(json={'id':'late-task'},headers=headers)
        except Exception:pass # 浏览器已按测试配置取消该请求。
    context.route('https://timeout.example/**',gateway)
    page.goto(BASE+'/#/video',wait_until='networkidle')
    page.get_by_role('button',name='设置',exact=True).click()
    settings=page.get_by_role('region',name='视频接口设置')
    field=settings.get_by_label('视频提交超时（秒）',exact=True)
    expect(field).to_have_value('600')
    field.fill('0');settings.get_by_role('button',name='保存视频配置').click()
    expect(page.locator('[data-settings-feedback]').get_by_role('alert')).to_contain_text('1–600')
    field.fill('1')
    settings.get_by_label('New API 网关根地址').fill('https://timeout.example')
    settings.get_by_label('豆包视频 API Key',exact=True).fill('test-timeout-key')
    settings.get_by_role('checkbox',name='在当前浏览器记住此 Key').first.check()
    settings.get_by_role('button',name='保存视频配置').click()
    page.get_by_role('button',name='关闭',exact=True).click()
    page.reload(wait_until='networkidle')
    composer=page.locator('[data-input-bar]')
    composer.locator('textarea').fill('Test delayed submission')
    composer.get_by_role('button',name='生成视频 →',exact=True).click()
    expect(composer.get_by_role('alert')).to_contain_text('视频提交等待超过 1 秒')
    expect(page.locator('[data-video-card]')).to_contain_text('提交结果待确认')
    expect(page.locator('[data-video-card]').get_by_role('button',name='重试',exact=True)).to_have_count(0)
    assert posts==['POST'],posts
    page.get_by_role('button',name='设置',exact=True).click()
    expect(settings.get_by_label('视频提交超时（秒）',exact=True)).to_have_value('1')
    page.get_by_role('button',name='关闭',exact=True).click()
    page.locator('header button').first.click()
    expect(composer.get_by_role('alert')).to_contain_text('Video submission exceeded 1 seconds')
    page.get_by_role('button',name='Settings',exact=True).click()
    expect(page.get_by_label('Video submission timeout (seconds)',exact=True)).to_have_value('1')
    assert not errors,errors
    print(json.dumps({'default600':True,'validation':True,'persistedTimeout':True,'actualAbortAfterConfiguredDeadline':True,'unknownSubmissionNoRetry':True,'english':True,'pageErrors':errors}))
    browser.close()
