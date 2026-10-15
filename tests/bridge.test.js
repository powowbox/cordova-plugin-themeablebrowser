const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBridge() {
    const calls = [];
    const queue = [];
    const context = {
        exports: {},
        window: {frames: {}},
        setTimeout: callback => queue.push(callback),
        require: name => ({
            'cordova/exec': (...args) => calls.push(args),
            'cordova/urlutil': {makeAbsolute: url => new URL(url, 'https://app.example/').href},
            'cordova/modulemapper': {},
            'cordova/channel': {create: () => {
                const listeners = new Set();
                return {subscribe: cb => listeners.add(cb), unsubscribe: cb => listeners.delete(cb),
                    fire: event => listeners.forEach(cb => cb(event))};
            }}
        })[name]
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../www/themeablebrowser.js'), 'utf8'), context);
    return {plugin: context.exports, calls, flush: () => queue.splice(0).forEach(cb => cb())};
}

test('open preserves typed options and registers listeners before native navigation', () => {
    const {plugin, calls, flush} = loadBridge();
    const options = {hidden: true, clearcache: false, toolbar: {height: 44, color: '#172643ff'}};
    const events = [];
    plugin.open('/sso', '_blank', options).addEventListener('loadstart', event => events.push(event.url));
    assert.equal(calls.length, 0);
    flush();
    assert.deepEqual(calls[0].slice(2, 4), ['ThemeableBrowser', 'open']);
    assert.equal(calls[0][4][0], 'https://app.example/sso');
    assert.deepEqual(JSON.parse(calls[0][4][2]), options);
    calls[0][0]({type: 'loadstart', url: 'https://api.example/sso-login-cb'});
    assert.deepEqual(events, ['https://api.example/sso-login-cb']);
});

test('native errors and exit events reach registered listeners', () => {
    const {plugin, calls, flush} = loadBridge();
    const events = [];
    const browser = plugin.open('https://idp.example/', '_blank', {});
    browser.addEventListener('loaderror', event => events.push(event.type));
    browser.addEventListener('exit', event => events.push(event.type));
    flush();
    calls[0][1]({type: 'loaderror', message: 'Connection failed'});
    calls[0][0]({type: 'exit'});
    assert.deepEqual(events, ['loaderror', 'exit']);
});

test('show, hide and close target the ThemeableBrowser native service', () => {
    const {plugin, calls, flush} = loadBridge();
    const browser = plugin.open('https://idp.example/', '_blank', {});
    flush();
    browser.show().hide().close();
    assert.deepEqual(calls.slice(1).map(call => call.slice(2, 4)),
        [['ThemeableBrowser', 'show'], ['ThemeableBrowser', 'hide'], ['ThemeableBrowser', 'close']]);
});
