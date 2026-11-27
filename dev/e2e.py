"""Drives the app at iPhone size against the local fake backend and saves screenshots."""
import subprocess, time, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
from playwright.sync_api import sync_playwright

OUT = os.path.join(HERE, 'shots')
os.makedirs(OUT, exist_ok=True)
web = subprocess.Popen([sys.executable, '-m', 'http.server', '8000', '--directory', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
api = subprocess.Popen(['node', os.path.join(HERE, 'fake_server.js')], stdout=subprocess.DEVNULL)
time.sleep(1.2)
errors = []

def shot(page, name):
    page.wait_for_timeout(450)
    page.screenshot(path=f'{OUT}/{name}.png')

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                                  user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.route('https://script.google.com/**', lambda route: route.fulfill(response=route.fetch(url='http://localhost:8787/')))

        page.goto('http://localhost:8000/index.html')
        shot(page, '01_setup')
        page.tap('[data-act="setup-me"][data-v="Orlando"]')
        page.fill('#su-api', 'https://script.google.com/macros/s/TEST/exec')
        page.fill('#su-pass', '4821')
        page.tap('[data-act="connect"]')
        page.wait_for_selector('.add-bar')
        shot(page, '02_empty_month')

        def add(amount, item, split=None, payer=None):
            page.tap('[data-act="add"]')
            page.wait_for_selector('#f-amount')
            page.wait_for_timeout(350)
            page.fill('#f-amount', amount)
            page.fill('#f-item', item)
            if payer: page.tap(f'[data-act="f-payer"][data-v="{payer}"]')
            if split: page.tap(f'[data-act="f-split"][data-v="{split}"]')
            return page

        add('86.40', 'Groceries')
        shot(page, '03_add_form')
        page.tap('#f-save')
        page.wait_for_timeout(150)
        shot(page, '04_pending')
        page.wait_for_selector('.exp:not(.pending)')
        add('48', 'Gas', split='60/40'); page.tap('#f-save')
        add('70', 'Internet', payer='Jonah'); page.tap('#f-save')
        add('90', 'Concert tickets', payer='Jonah', split='0/100')
        shot(page, '05_add_form_jonah_paid')
        page.tap('#f-save')
        page.wait_for_function("document.querySelectorAll('.exp:not(.pending)').length === 4")
        page.wait_for_timeout(300)
        shot(page, '06_home_orlando')
        bal = page.inner_text('.card')
        print('BALANCE CARD (Orlando):', bal.replace('\n', ' | '))

        # edit Gas -> 60
        page.tap('.exp:has-text("Gas")')
        page.wait_for_selector('#f-del')
        page.fill('#f-amount', '60')
        shot(page, '07_edit_form')
        page.tap('#f-save')
        page.wait_for_selector('.page', state='detached')
        page.wait_for_timeout(300)
        print('AFTER EDIT:', page.inner_text('.card').replace('\n', ' | '))

        # switch to Jonah's view
        page.tap('[data-act="settings"]')
        page.wait_for_selector('[data-act="set-me"]')
        shot(page, '08_settings')
        page.tap('[data-act="set-me"][data-v="Jonah"]')
        page.tap('.page [data-act="close"]')
        page.wait_for_timeout(400)
        shot(page, '09_home_jonah')
        print('BALANCE CARD (Jonah):', page.inner_text('.card').replace('\n', ' | '))

        # settle and close as Jonah
        page.tap('[data-act="settle"]')
        page.wait_for_selector('.sheet.in')
        shot(page, '10_settle_no_venmo')
        page.fill('#v-handle', 'orlando-n')
        page.tap('[data-act="save-venmo"]')
        page.wait_for_selector('a.btn.venmo')
        shot(page, '11_settle_with_venmo')
        print('VENMO LINK:', page.get_attribute('a.btn.venmo', 'href'))
        page.tap('[data-act="close-month"]')
        page.wait_for_selector('.pill.closed')
        page.wait_for_timeout(300)
        shot(page, '12_closed')

        page.tap('[data-act="months"]')
        page.wait_for_selector('.sheet.in')
        shot(page, '13_months')
        page.tap('.sheet [data-act="new-month"]')
        page.wait_for_selector('.toast.in')
        shot(page, '14_new_month')
        print('HEADER:', page.inner_text('.month-btn'))

        # reopen previous month and delete an expense
        page.tap('[data-act="months"]'); page.wait_for_selector('.sheet.in')
        page.tap('.mrow:has-text("November")')
        page.wait_for_selector('[data-act="reopen"]')
        page.tap('[data-act="reopen"]')
        page.wait_for_selector('.add-bar')
        page.tap('.exp:has-text("Internet")'); page.wait_for_selector('#f-del')
        page.tap('#f-del'); page.tap('#f-del')
        page.wait_for_selector('.page', state='detached')
        page.wait_for_timeout(300)
        print('AFTER DELETE:', page.inner_text('.card').replace('\n', ' | '))
        print('ROWS:', [t.replace('\n', ' ') for t in page.locator('.exp').all_inner_texts()])

        # dark mode + demo
        dark = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme='dark')
        dp = dark.new_page(); dp.on('pageerror', lambda e: errors.append(str(e)))
        dp.goto('http://localhost:8000/index.html?demo')
        dp.wait_for_selector('.exp')
        shot(dp, '15_demo_dark')
        small = browser.new_context(viewport={'width': 375, 'height': 667}, device_scale_factor=2, is_mobile=True, has_touch=True)
        sp = small.new_page(); sp.goto('http://localhost:8000/index.html?demo'); sp.wait_for_selector('.exp')
        shot(sp, '16_demo_iphone_se')
        sp.tap('[data-act="add"]'); sp.wait_for_selector('#f-amount')
        shot(sp, '17_add_form_iphone_se')
        browser.close()
finally:
    web.terminate(); api.terminate()
print('ERRORS:', errors or 'none')
