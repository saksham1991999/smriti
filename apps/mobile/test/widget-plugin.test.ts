/**
 * The widgets config plugin (apps/mobile/plugins/widgets): its generated strings, colours and
 * images, and its config mods on a real Expo pbxproj (fixture from `expo prebuild`) and manifest.
 * `expo prebuild --no-install` runs the whole plugin; these tests pin the pieces.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { WIDGET_IMAGES } from '../src/platform/widget';

import { IOSConfig } from 'expo/config-plugins';

const plugin = require('../plugins/widgets/index.cjs');

const h = plugin.helpers;
const MOBILE = path.resolve(__dirname, '..');
const variant = h.readVariant('jee');

/** A fresh copy of the pbxproj that `expo prebuild` made before the plugin existed. */
function fixtureProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smriti-widget-'));
  const dir = path.join(root, 'ios', 'Smritilocal.xcodeproj');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'widget', 'project.pbxproj'), path.join(dir, 'project.pbxproj'));
  return IOSConfig.XcodeUtils.getPbxproj(root) as any;
}

describe('widget plugin: generated content', () => {
  it('copies exactly the images the app can name', () => {
    expect([...h.widgetImages()].sort()).toEqual([...WIDGET_IMAGES].sort());
  });

  it('takes every image from the seed pack with its Agnes licence and EN/HI alt text', () => {
    const art = h.widgetArt();
    expect(art).toHaveLength(WIDGET_IMAGES.length);
    for (const a of art) {
      expect(fs.existsSync(a.file)).toBe(true);
      expect(a.file.startsWith(path.join(MOBILE, 'assets', 'illustrations'))).toBe(true);
      expect(a.alt.en.length).toBeGreaterThan(0);
      expect(a.alt.hi.length).toBeGreaterThan(0);
    }
  });

  it('refuses an illustration without a cleared licence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smriti-art-'));
    const meta = JSON.parse(fs.readFileSync(path.join(MOBILE, 'assets', 'illustrations', 'illustrations.json'), 'utf8'));
    meta['plant-seed'] = { ...meta['plant-seed'], licence: 'CC-BY-NC-4.0', source: 'web' };
    fs.writeFileSync(path.join(dir, 'illustrations.json'), JSON.stringify(meta));
    for (const name of WIDGET_IMAGES) fs.writeFileSync(path.join(dir, `${name}.webp`), '');
    expect(() => h.widgetArt(dir)).toThrow(/plant-seed: licence/);
  });

  it('builds the native strings in English and Hindi from the catalogue, with the brand filled', () => {
    const s = h.widgetStrings(variant.appName);
    expect(s.en.placeholder).toBe(`Open ${variant.appName.en} to start`);
    expect(s.en.plant_name).toBe('Streak plant');
    expect(s.en.today_name).toBe('Pet and today');
    expect(s.hi.plan_name).toBe('आज का प्लान');
    expect(s.hi.placeholder).toContain(variant.appName.hi);
    for (const locale of ['en', 'hi']) for (const v of Object.values(s[locale]) as string[]) expect(v).not.toMatch(/[{}]/);
  });

  it('takes colours from the tokens and the variant accent', () => {
    const tokens = require('../../../packages/tokens/tokens.json');
    const c = h.widgetColors('examAccent.neet');
    expect(c.light.accent).toBe(tokens.examAccent.neet.light);
    expect(c.dark.onAccent).toBe(tokens.examAccent.neet.onAccentDark);
    expect(c.light.surface).toBe(tokens.color.light.surface);
    expect(c.dark.ink).toBe(tokens.color.dark.ink);
  });

  it('generates Swift and Kotlin catalogues that escape their strings', () => {
    const art = [{ name: 'cat-base', file: '', alt: { en: 'A "cat" $5 \\ ok', hi: 'बिल्ली' } }];
    const swift = h.swiftCatalog({ en: { placeholder: 'Open "X"' }, hi: { placeholder: 'खोलें' } }, art);
    expect(swift).toContain('"placeholder": "Open \\"X\\""');
    expect(swift).toContain('"cat-base": [');
    const kotlin = h.kotlinCatalog(art);
    expect(kotlin).toContain('package app.smriti.widget');
    expect(kotlin).toContain('"A \\"cat\\" \\$5 \\\\ ok"');
    expect(h.xmlString("Don't <b> & @home")).toBe("Don\\'t &lt;b&gt; &amp; @home");
    expect(h.xmlString('@string/x')).toBe('\\@string/x');
  });

  it('imports the app R class into the Kotlin providers', () => {
    const kt = h.kotlinProviders('app.smriti.jee.dev');
    expect(kt).toContain('import app.smriti.jee.dev.R');
    expect(kt).not.toContain('__NAMESPACE__');
    for (const r of h.RECEIVERS) expect(kt).toContain(`class ${r.name}`);
  });

  it('writes the extension Info.plist and entitlements with the App Group', () => {
    const plist = h.iosInfoPlist({ displayName: 'Smriti JEE', appGroup: 'group.app.smriti.jee' });
    expect(plist).toContain('<string>com.apple.widgetkit-extension</string>');
    expect(plist).toContain(`<key>${h.APP_GROUP_KEY}</key>\n  <string>group.app.smriti.jee</string>`);
    expect(h.iosEntitlements('group.app.smriti.jee')).toContain('<string>group.app.smriti.jee</string>');
    expect(h.appGroupFor({ ios: { bundleIdentifier: 'a.b', entitlements: { 'com.apple.security.application-groups': ['group.x'] } } })).toBe('group.x');
    expect(h.appGroupFor({ ios: { bundleIdentifier: 'a.b' } })).toBe('group.a.b');
  });
});

describe('widget plugin: Xcode project', () => {
  const files = h.iosFiles(WIDGET_IMAGES);

  it('adds the WidgetKit extension target, embedded in the app', () => {
    const project = fixtureProject();
    expect(h.addWidgetTarget(project, { bundleId: 'app.smriti.jee.dev.widget', version: '1.0.0', buildNumber: '7', files })).toBe(true);
    const target = project.pbxTargetByName(h.TARGET);
    expect(target).toBeTruthy();
    expect(target.productType).toBe('"com.apple.product-type.app-extension"');

    const phases = target.buildPhases.map((p: { comment: string }) => p.comment);
    expect(phases).toEqual(['Sources', 'Resources', 'Frameworks']);

    const out: string = project.writeSync();
    for (const f of files.sources) expect(out).toContain(`${f} in Sources`);
    for (const f of files.resources) expect(out).toContain(`${f} in Resources`);
    expect(out).toContain('SmritiWidget.appex in Copy Files');
    expect(out).toContain('name = "Embed Foundation Extensions"');
    expect(out).toContain('dstSubfolderSpec = 13');
    expect(out).toContain('PBXTargetDependency');
    expect(out).not.toContain('undefined');
    expect(out).not.toContain('SmritiWidget-Info.plist in');

    const configs = Object.values(project.pbxXCBuildConfigurationSection()).filter(
      (c: any) => typeof c === 'object' && c.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER === 'app.smriti.jee.dev.widget',
    ) as { buildSettings: Record<string, string> }[];
    expect(configs).toHaveLength(2);
    for (const c of configs) {
      expect(c.buildSettings).toMatchObject({
        INFOPLIST_FILE: 'SmritiWidget/SmritiWidget-Info.plist',
        CODE_SIGN_ENTITLEMENTS: 'SmritiWidget/SmritiWidget.entitlements',
        IPHONEOS_DEPLOYMENT_TARGET: '16.4',
        CURRENT_PROJECT_VERSION: '7',
        MARKETING_VERSION: '1.0.0',
        SWIFT_VERSION: '5.0',
      });
    }
  });

  it('puts the extension group in the main group and does nothing the second time', () => {
    const project = fixtureProject();
    h.addWidgetTarget(project, { bundleId: 'x.widget', version: '1.0.0', buildNumber: '1', files });
    const mainGroup = project.getPBXGroupByKey(project.getFirstProject().firstProject.mainGroup);
    expect(mainGroup.children.map((c: { comment: string }) => c.comment)).toContain(h.TARGET);
    const before = project.writeSync();
    expect(h.addWidgetTarget(project, { bundleId: 'x.widget', version: '1.0.0', buildNumber: '1', files })).toBe(false);
    expect(project.writeSync()).toBe(before);
  });
});

describe('widget plugin: Android manifest', () => {
  it('adds the three AppWidget receivers once', () => {
    const manifest = { manifest: { $: {}, application: [{ $: { 'android:name': '.MainApplication' }, activity: [] }] } };
    h.addWidgetReceivers(manifest);
    h.addWidgetReceivers(manifest);
    const receivers = (manifest.manifest.application[0] as any).receiver;
    expect(receivers).toHaveLength(3);
    expect(receivers.map((r: any) => r.$['android:name'])).toEqual([
      'app.smriti.widget.SmritiPlantWidgetProvider',
      'app.smriti.widget.SmritiTodayWidgetProvider',
      'app.smriti.widget.SmritiPlanWidgetProvider',
    ]);
    for (const r of receivers) {
      expect(r.$['android:exported']).toBe('false');
      expect(r['intent-filter'][0].action[0].$['android:name']).toBe('android.appwidget.action.APPWIDGET_UPDATE');
      expect(r['meta-data'][0].$['android:name']).toBe('android.appwidget.provider');
    }
  });
});

describe('widget plugin: whole config', () => {
  it('registers the mods and the EAS app extension', () => {
    const config = {
      name: 'Smriti JEE (local)',
      slug: 'smriti-jee',
      version: '1.0.0',
      ios: { bundleIdentifier: 'app.smriti.jee.dev', entitlements: { 'com.apple.security.application-groups': ['group.app.smriti.jee'] } },
      android: { package: 'app.smriti.jee.dev' },
      extra: { variantId: 'jee' },
    };
    const out = plugin(config);
    expect(out.extra.eas.build.experimental.ios.appExtensions).toEqual([
      {
        targetName: 'SmritiWidget',
        bundleIdentifier: 'app.smriti.jee.dev.widget',
        entitlements: { 'com.apple.security.application-groups': ['group.app.smriti.jee'] },
      },
    ]);
    expect(Object.keys(out.mods.ios).sort()).toEqual(['dangerous', 'infoPlist', 'xcodeproj']);
    expect(Object.keys(out.mods.android).sort()).toEqual(['dangerous', 'manifest']);
  });
});
