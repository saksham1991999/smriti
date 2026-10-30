/**
 * Expo config plugin for the home-screen widgets (G-5; me-money NTF-08, NTF-09, NTF-10).
 *
 * iOS: adds the `SmritiWidget` WidgetKit extension target (sources in targets/widget-ios), its
 * Info.plist and entitlements (the app's App Group), and the `SmritiWidgetAppGroup` Info.plist key
 * that the app's SmritiWidget module and the extension both read.
 * Android: adds three AppWidget receivers, the Kotlin providers (targets/widget-android) and their
 * layouts, and generated strings, colours and drawables.
 *
 * Generated, never hand-written: the strings (from @smriti/i18n, EN and HI, `{brand}` filled from
 * the variant), the colours (from packages/tokens/tokens.json) and the images (seed-pack
 * illustrations from Agnes, copied only when illustrations.json records an allowed licence).
 *
 * The helpers are exported for the Jest tests in apps/mobile/test/widget-plugin.test.ts.
 */
const fs = require('node:fs');
const path = require('node:path');
const { AndroidConfig, withAndroidManifest, withDangerousMod, withInfoPlist, withXcodeProject } = require('expo/config-plugins');

const TARGET = 'SmritiWidget';
const APP_GROUP_KEY = 'SmritiWidgetAppGroup';
const IOS_DEPLOYMENT_TARGET = '16.4';
const KOTLIN_PACKAGE = 'app.smriti.widget';

const MOBILE = path.resolve(__dirname, '..', '..');
const REPO = path.resolve(MOBILE, '..', '..');
const IOS_SRC = path.join(MOBILE, 'targets', 'widget-ios');
const ANDROID_SRC = path.join(MOBILE, 'targets', 'widget-android');
const ILLUSTRATIONS = path.join(MOBILE, 'assets', 'illustrations');

// ── Images (mirror of WIDGET_IMAGES in src/platform/widget.ts; a test keeps them equal) ─────────

const PLANT_STAGES = ['seed', 'sprout', 'sapling', 'flowering', 'tree'];
const PLANT_HEALTH = ['thriving', 'droopy', 'dry', 'wilted', 'dormant'];
const PET_ART = { happy: 'base', content: 'base', sleepy: 'sleepy', tired: 'sleepy', missing_you: 'worried', resting: 'resting' };
const ALLOWED_LICENCES = new Set(['owned']);

function widgetImages() {
  const plant = (stage, health) => (stage === 'sapling' && health !== 'thriving' ? `plant-sapling-${health}` : `plant-${stage}`);
  return [
    ...new Set([
      'plant-seed',
      ...PLANT_STAGES.flatMap((s) => PLANT_HEALTH.map((h) => plant(s, h))),
      ...['cat', 'dog'].flatMap((sp) => Object.keys(PET_ART).map((st) => `${sp}-${PET_ART[st]}`)),
    ]),
  ];
}

/** The widget images with their files and alt text; throws on a missing file or licence. */
function widgetArt(dir = ILLUSTRATIONS) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'illustrations.json'), 'utf8'));
  return widgetImages().map((name) => {
    const m = meta[name];
    const file = path.join(dir, `${name}.webp`);
    if (!m || !fs.existsSync(file)) throw new Error(`[widgets] Missing seed illustration ${name}.webp (apps/mobile/assets/illustrations)`);
    if (!ALLOWED_LICENCES.has(m.licence) || m.source !== 'agnes') {
      throw new Error(`[widgets] ${name}: licence "${m.licence}" from "${m.source}" is not cleared for the widgets`);
    }
    if (!m.alt || !m.alt.en || !m.alt.hi) throw new Error(`[widgets] ${name}: alt text needs en and hi`);
    return { name, file, alt: { en: m.alt.en, hi: m.alt.hi } };
  });
}

// ── Variant, strings and colours ────────────────────────────────────────────────

function readVariant(id) {
  const key = id || 'all';
  return JSON.parse(fs.readFileSync(path.join(REPO, 'packages', 'config', 'variants', `${key}.json`), 'utf8'));
}

function readCatalog(locale) {
  return JSON.parse(fs.readFileSync(path.join(REPO, 'packages', 'i18n', 'src', 'locales', locale, 'me_money.json'), 'utf8'));
}

const STRING_KEYS = {
  placeholder: 'NTF-08.placeholder',
  plant_name: 'NTF-08.widget_gallery_name',
  plant_description: 'NTF-08.widget_gallery_description',
  // NTF-09.widget_gallery_name is "{pet} and today", and the pet is unknown at build time.
  today_name: 'NTF-11.sizes.2',
  today_description: 'NTF-09.widget_gallery_description',
  plan_name: 'NTF-10.widget_gallery_name',
  plan_description: 'NTF-10.widget_gallery_description',
};

/** The few strings the natives hold themselves: `{ en: {...}, hi: {...} }`. */
function widgetStrings(appName, catalogs = { en: readCatalog('en'), hi: readCatalog('hi') }) {
  const out = {};
  for (const locale of ['en', 'hi']) {
    out[locale] = {};
    for (const [name, key] of Object.entries(STRING_KEYS)) {
      const raw = catalogs[locale][key];
      if (typeof raw !== 'string') throw new Error(`[widgets] Missing me_money:${key} (${locale})`);
      const text = raw.replace(/\{brand\}/g, appName[locale] || appName.en);
      if (/[{}]/.test(text)) throw new Error(`[widgets] me_money:${key} (${locale}) has a placeholder the widget cannot fill`);
      out[locale][name] = text;
    }
  }
  return out;
}

const COLOR_TOKENS = ['surface', 'surfaceSunken', 'line', 'track', 'ink', 'inkMuted', 'streakText', 'success', 'successText'];

/** `{ light: {name: '#RRGGBB'}, dark: {...} }` from tokens.json, plus the variant accent. */
function widgetColors(accentRef, tokens = JSON.parse(fs.readFileSync(path.join(REPO, 'packages', 'tokens', 'tokens.json'), 'utf8'))) {
  const exam = String(accentRef).split('.')[1];
  const accent = tokens.examAccent[exam];
  if (!accent) throw new Error(`[widgets] Unknown accent ${accentRef}`);
  const out = {};
  for (const mode of ['light', 'dark']) {
    out[mode] = {};
    for (const name of COLOR_TOKENS) out[mode][name] = tokens.color[mode][name];
    out[mode].accent = accent[mode];
    out[mode].onAccent = mode === 'light' ? accent.onAccentLight : accent.onAccentDark;
    for (const [name, value] of Object.entries(out[mode])) {
      if (!/^#[0-9A-Fa-f]{6}$/.test(value || '')) throw new Error(`[widgets] Token ${mode}.${name} is not a #RRGGBB colour`);
    }
  }
  return out;
}

// ── Code generation ──────────────────────────────────────────────────────────────

const HEADER = 'Generated by apps/mobile/plugins/widgets at prebuild. Do not edit.';

function swiftString(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
}

function kotlinString(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
}

function xmlString(s) {
  const escaped = String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
  return /^[@?]/.test(escaped) ? `\\${escaped}` : escaped;
}

const camel = (s) => s.replace(/[-_]([a-z])/g, (_, c) => c.toUpperCase());
const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function swiftCatalog(strings, art) {
  const dict = (obj, indent) =>
    `[\n${Object.entries(obj)
      .map(([k, v]) => `${indent}  ${swiftString(k)}: ${typeof v === 'string' ? swiftString(v) : dict(v, `${indent}  `)}`)
      .join(',\n')}\n${indent}]`;
  const alt = Object.fromEntries(art.map((a) => [a.name, a.alt]));
  return `// ${HEADER}
// Strings from @smriti/i18n (me_money), alt text from apps/mobile/assets/illustrations.

enum WidgetCatalog {
  static let strings: [String: [String: String]] = ${dict(strings, '  ')}

  static let alt: [String: [String: String]] = ${dict(alt, '  ')}
}
`;
}

function swiftTheme(colors) {
  const hex = (v) => `0x${v.slice(1).toUpperCase()}`;
  const lines = Object.keys(colors.light).map((name) => `  static let ${camel(name)} = adaptive(${hex(colors.light[name])}, ${hex(colors.dark[name])})`);
  return `// ${HEADER}
// Colours from packages/tokens/tokens.json (light, dark) and the variant's exam accent.

import SwiftUI
import UIKit

enum WidgetTheme {
${lines.join('\n')}

  private static func adaptive(_ light: UInt32, _ dark: UInt32) -> Color {
    Color(UIColor { $0.userInterfaceStyle == .dark ? WidgetTheme.rgb(dark) : WidgetTheme.rgb(light) })
  }

  private static func rgb(_ value: UInt32) -> UIColor {
    UIColor(
      red: CGFloat((value >> 16) & 0xFF) / 255,
      green: CGFloat((value >> 8) & 0xFF) / 255,
      blue: CGFloat(value & 0xFF) / 255,
      alpha: 1
    )
  }
}
`;
}

function kotlinCatalog(art) {
  const entries = art
    .map((a) => `    ${kotlinString(a.name)} to mapOf("en" to ${kotlinString(a.alt.en)}, "hi" to ${kotlinString(a.alt.hi)})`)
    .join(',\n');
  return `// ${HEADER}
// Alt text from apps/mobile/assets/illustrations/illustrations.json.
package ${KOTLIN_PACKAGE}

object WidgetCatalog {
  val alt: Map<String, Map<String, String>> = mapOf(
${entries},
  )
}
`;
}

function androidStringsXml(strings) {
  const rows = Object.entries(strings).map(([k, v]) => `    <string name="smriti_widget_${k}">${xmlString(v)}</string>`);
  return `<?xml version="1.0" encoding="utf-8"?>\n<!-- ${HEADER} -->\n<resources>\n${rows.join('\n')}\n</resources>\n`;
}

function androidColorsXml(colors) {
  const rows = Object.entries(colors).map(([k, v]) => `    <color name="smriti_widget_${snake(k)}">${v.toUpperCase()}</color>`);
  return `<?xml version="1.0" encoding="utf-8"?>\n<!-- ${HEADER} -->\n<resources>\n${rows.join('\n')}\n</resources>\n`;
}

/** Keeps the drawables that the providers look up by name (resource shrinking cannot see them). */
const ANDROID_KEEP_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- ${HEADER} -->
<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="@drawable/smriti_widget_*" />
`;

function iosInfoPlist({ displayName, appGroup }) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>${esc(displayName)}</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleLocalizations</key>
  <array>
    <string>en</string>
    <string>hi</string>
  </array>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key>
  <string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key>
  <string>$(CURRENT_PROJECT_VERSION)</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.widgetkit-extension</string>
  </dict>
  <key>${APP_GROUP_KEY}</key>
  <string>${esc(appGroup)}</string>
</dict>
</plist>
`;
}

function iosEntitlements(appGroup) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${appGroup}</string>
  </array>
</dict>
</plist>
`;
}

// ── iOS ──────────────────────────────────────────────────────────────────────────

/** The App Group the app already declares (app.config.ts), or `group.<bundle id>`. */
function appGroupFor(config) {
  const groups = config.ios?.entitlements?.['com.apple.security.application-groups'];
  if (Array.isArray(groups) && groups.length > 0) return groups[0];
  if (!config.ios?.bundleIdentifier) throw new Error('[widgets] ios.bundleIdentifier is required');
  return `group.${config.ios.bundleIdentifier}`;
}

const IOS_SOURCES = ['WidgetModel.swift', 'WidgetViews.swift', 'SmritiWidgetBundle.swift'];
const IOS_GENERATED = ['WidgetCatalog.swift', 'WidgetTheme.swift'];
const IOS_INFO_PLIST = `${TARGET}-Info.plist`;
const IOS_ENTITLEMENTS = `${TARGET}.entitlements`;

function iosFiles(images) {
  return {
    sources: [...IOS_SOURCES, ...IOS_GENERATED],
    resources: images.map((n) => `${n}.webp`),
    support: [IOS_INFO_PLIST, IOS_ENTITLEMENTS],
  };
}

const FILE_TYPES = { swift: 'sourcecode.swift', webp: 'file', plist: 'text.plist.xml', entitlements: 'text.plist.entitlements' };

function quote(v) {
  return /^[A-Za-z0-9_.$()/]+$/.test(v) ? v : `"${String(v).replace(/"/g, '\\"')}"`;
}

/**
 * Adds the WidgetKit extension target to a node-xcode project: a group with the sources,
 * resources and support files; Sources, Resources and Frameworks phases; the embed phase and a
 * dependency in the app target; and the build settings. Does nothing when the target exists.
 */
function addWidgetTarget(project, opts) {
  if (project.pbxTargetByName(TARGET) || project.pbxTargetByName(`"${TARGET}"`)) return false;
  const { bundleId, version, buildNumber, files } = opts;
  const appTarget = project.getFirstTarget();
  const appSettings = Object.values(project.pbxXCBuildConfigurationSection()).find(
    (c) => typeof c === 'object' && c.buildSettings && c.buildSettings.PRODUCT_BUNDLE_IDENTIFIER && c.buildSettings.DEVELOPMENT_TEAM,
  );

  const target = project.addTarget(TARGET, 'app_extension', TARGET, bundleId);

  const all = [...files.sources, ...files.resources, ...files.support];
  const group = project.addPbxGroup(all, TARGET, TARGET);
  const refs = project.pbxFileReferenceSection();
  for (const child of group.pbxGroup.children) {
    const ref = refs[child.value];
    const ext = String(ref.path).replace(/"/g, '').split('.').pop();
    if (FILE_TYPES[ext]) ref.lastKnownFileType = FILE_TYPES[ext];
    delete ref.explicitFileType;
    delete ref.includeInIndex;
    for (const k of Object.keys(ref)) if (ref[k] === undefined) delete ref[k];
  }
  const mainGroup = project.getFirstProject().firstProject.mainGroup;
  project.addToPbxGroup(group.uuid, mainGroup);

  // Tidy what node-xcode leaves: build files for the plist and entitlements (they are not built),
  // "undefined" fields and quoted names on the product and target.
  const buildFiles = project.pbxBuildFileSection();
  const supportRefs = new Set(
    group.pbxGroup.children.filter((c) => files.support.includes(String(refs[c.value].path).replace(/"/g, ''))).map((c) => c.value),
  );
  for (const [key, bf] of Object.entries(buildFiles)) {
    if (typeof bf === 'object' && supportRefs.has(bf.fileRef)) {
      delete buildFiles[key];
      delete buildFiles[`${key}_comment`];
    }
  }
  const product = refs[target.pbxNativeTarget.productReference];
  for (const k of Object.keys(product)) if (product[k] === undefined) delete product[k];
  const native = project.pbxNativeTargetSection();
  native[target.uuid].name = TARGET;
  native[target.uuid].productName = TARGET;
  native[target.uuid].productReference_comment = `${TARGET}.appex`;
  native[`${target.uuid}_comment`] = TARGET;
  for (const t of project.getFirstProject().firstProject.targets) if (t.value === target.uuid) t.comment = TARGET;

  project.addBuildPhase(files.sources, 'PBXSourcesBuildPhase', 'Sources', target.uuid);
  project.addBuildPhase(files.resources, 'PBXResourcesBuildPhase', 'Resources', target.uuid);
  project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
  // node-xcode only records the dependency when both sections exist.
  const objects = project.hash.project.objects;
  objects.PBXTargetDependency = objects.PBXTargetDependency || {};
  objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};
  project.addTargetDependency(appTarget.uuid, [target.uuid]);

  // Name the embed phase the way Xcode does.
  const copyPhases = project.hash.project.objects.PBXCopyFilesBuildPhase || {};
  for (const [key, phase] of Object.entries(copyPhases)) {
    if (key.endsWith('_comment') || typeof phase !== 'object') continue;
    if (phase.name === '"Copy Files"' && phase.dstSubfolderSpec === 13) {
      phase.name = '"Embed Foundation Extensions"';
      copyPhases[`${key}_comment`] = 'Embed Foundation Extensions';
      for (const ref of appTarget.firstTarget.buildPhases) if (ref.value === key) ref.comment = 'Embed Foundation Extensions';
    }
  }

  const settings = {
    APPLICATION_EXTENSION_API_ONLY: 'YES',
    CLANG_ENABLE_MODULES: 'YES',
    CODE_SIGN_ENTITLEMENTS: `${TARGET}/${IOS_ENTITLEMENTS}`,
    CODE_SIGN_STYLE: 'Automatic',
    CURRENT_PROJECT_VERSION: quote(buildNumber),
    GENERATE_INFOPLIST_FILE: 'NO',
    INFOPLIST_FILE: `${TARGET}/${IOS_INFO_PLIST}`,
    IPHONEOS_DEPLOYMENT_TARGET: IOS_DEPLOYMENT_TARGET,
    LD_RUNPATH_SEARCH_PATHS: '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
    MARKETING_VERSION: quote(version),
    PRODUCT_BUNDLE_IDENTIFIER: quote(bundleId),
    PRODUCT_NAME: quote('$(TARGET_NAME)'),
    SDKROOT: 'iphoneos',
    SKIP_INSTALL: 'YES',
    SWIFT_EMIT_LOC_STRINGS: 'NO',
    SWIFT_VERSION: '5.0',
    TARGETED_DEVICE_FAMILY: '"1,2"',
  };
  if (appSettings) settings.DEVELOPMENT_TEAM = appSettings.buildSettings.DEVELOPMENT_TEAM;
  const list = project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList];
  for (const { value } of list.buildConfigurations) {
    const conf = project.pbxXCBuildConfigurationSection()[value];
    Object.assign(conf.buildSettings, settings);
    if (conf.name === 'Debug') conf.buildSettings.SWIFT_OPTIMIZATION_LEVEL = '"-Onone"';
  }
  return true;
}

function withIosWidget(config, { variant }) {
  const appGroup = appGroupFor(config);
  const bundleId = `${config.ios.bundleIdentifier}.widget`;
  const art = widgetArt();
  const files = iosFiles(art.map((a) => a.name));

  config = withInfoPlist(config, (c) => {
    c.modResults[APP_GROUP_KEY] = appGroup;
    return c;
  });

  config = withDangerousMod(config, [
    'ios',
    (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, TARGET);
      fs.mkdirSync(dir, { recursive: true });
      for (const f of IOS_SOURCES) fs.copyFileSync(path.join(IOS_SRC, f), path.join(dir, f));
      fs.writeFileSync(path.join(dir, 'WidgetCatalog.swift'), swiftCatalog(widgetStrings(variant.appName), art));
      fs.writeFileSync(path.join(dir, 'WidgetTheme.swift'), swiftTheme(widgetColors(variant.accentColor)));
      fs.writeFileSync(path.join(dir, IOS_INFO_PLIST), iosInfoPlist({ displayName: c.name, appGroup }));
      fs.writeFileSync(path.join(dir, IOS_ENTITLEMENTS), iosEntitlements(appGroup));
      for (const a of art) fs.copyFileSync(a.file, path.join(dir, `${a.name}.webp`));
      return c;
    },
  ]);

  config = withXcodeProject(config, (c) => {
    addWidgetTarget(c.modResults, {
      bundleId,
      version: c.version || '1.0.0',
      buildNumber: c.ios?.buildNumber || '1',
      files,
    });
    return c;
  });

  // EAS needs to sign the extension with its own profile and the same App Group.
  const eas = { ...(config.extra?.eas || {}) };
  const build = { ...(eas.build || {}) };
  const experimental = { ...(build.experimental || {}) };
  const ios = { ...(experimental.ios || {}) };
  const others = (ios.appExtensions || []).filter((e) => e.targetName !== TARGET);
  ios.appExtensions = [
    ...others,
    { targetName: TARGET, bundleIdentifier: bundleId, entitlements: { 'com.apple.security.application-groups': [appGroup] } },
  ];
  config.extra = { ...(config.extra || {}), eas: { ...eas, build: { ...build, experimental: { ...experimental, ios } } } };
  return config;
}

// ── Android ──────────────────────────────────────────────────────────────────────

const RECEIVERS = [
  { name: 'SmritiPlantWidgetProvider', info: 'smriti_widget_plant_info', label: 'smriti_widget_plant_name' },
  { name: 'SmritiTodayWidgetProvider', info: 'smriti_widget_today_info', label: 'smriti_widget_today_name' },
  { name: 'SmritiPlanWidgetProvider', info: 'smriti_widget_plan_info', label: 'smriti_widget_plan_name' },
];

/** Adds the three AppWidget receivers to the manifest's <application>; idempotent. */
function addWidgetReceivers(manifest) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  app.receiver = (app.receiver || []).filter((r) => !RECEIVERS.some((w) => r.$['android:name'] === `${KOTLIN_PACKAGE}.${w.name}`));
  for (const w of RECEIVERS) {
    app.receiver.push({
      $: { 'android:name': `${KOTLIN_PACKAGE}.${w.name}`, 'android:exported': 'false', 'android:label': `@string/${w.label}` },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] }],
      'meta-data': [{ $: { 'android:name': 'android.appwidget.provider', 'android:resource': `@xml/${w.info}` } }],
    });
  }
  return manifest;
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

/** The Kotlin providers with the app's R class imported. */
function kotlinProviders(namespace) {
  return fs.readFileSync(path.join(ANDROID_SRC, 'SmritiWidgets.kt'), 'utf8').replace(/__NAMESPACE__/g, namespace);
}

function withAndroidWidget(config, { variant }) {
  config = withAndroidManifest(config, (c) => {
    addWidgetReceivers(c.modResults);
    return c;
  });
  config = withDangerousMod(config, [
    'android',
    (c) => {
      const namespace = c.android?.package;
      if (!namespace) throw new Error('[widgets] android.package is required');
      const main = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main');
      const java = path.join(main, 'java', ...KOTLIN_PACKAGE.split('.'));
      fs.mkdirSync(java, { recursive: true });
      fs.writeFileSync(path.join(java, 'SmritiWidgets.kt'), kotlinProviders(namespace));
      const art = widgetArt();
      fs.writeFileSync(path.join(java, 'WidgetCatalog.kt'), kotlinCatalog(art));

      const res = path.join(main, 'res');
      copyDir(path.join(ANDROID_SRC, 'res'), res);
      const strings = widgetStrings(variant.appName);
      const colors = widgetColors(variant.accentColor);
      const write = (dir, file, text) => {
        fs.mkdirSync(path.join(res, dir), { recursive: true });
        fs.writeFileSync(path.join(res, dir, file), text);
      };
      write('values', 'smriti_widget_strings.xml', androidStringsXml(strings.en));
      write('values-hi', 'smriti_widget_strings.xml', androidStringsXml(strings.hi));
      write('values', 'smriti_widget_colors.xml', androidColorsXml(colors.light));
      write('values-night', 'smriti_widget_colors.xml', androidColorsXml(colors.dark));
      write('raw', 'smriti_widget_keep.xml', ANDROID_KEEP_XML);
      fs.mkdirSync(path.join(res, 'drawable-nodpi'), { recursive: true });
      for (const a of art) fs.copyFileSync(a.file, path.join(res, 'drawable-nodpi', `smriti_widget_${a.name.replace(/-/g, '_')}.webp`));
      return c;
    },
  ]);
  return config;
}

// ── Plugin ───────────────────────────────────────────────────────────────────────

function withSmritiWidgets(config) {
  const variant = readVariant(config.extra?.variantId);
  config = withIosWidget(config, { variant });
  config = withAndroidWidget(config, { variant });
  return config;
}

module.exports = withSmritiWidgets;
module.exports.helpers = {
  TARGET,
  APP_GROUP_KEY,
  KOTLIN_PACKAGE,
  RECEIVERS,
  widgetImages,
  widgetArt,
  widgetStrings,
  widgetColors,
  swiftCatalog,
  swiftTheme,
  kotlinCatalog,
  kotlinProviders,
  androidStringsXml,
  androidColorsXml,
  iosInfoPlist,
  iosEntitlements,
  iosFiles,
  appGroupFor,
  addWidgetTarget,
  addWidgetReceivers,
  xmlString,
  readVariant,
};
