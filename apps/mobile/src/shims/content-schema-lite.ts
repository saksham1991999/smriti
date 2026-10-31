/**
 * The runtime half of `@smriti/content-schema` that the app uses: constants, localize (with
 * splitMath and the blank token) and units. The package root also exports the JSON schemas and
 * the ajv validators, which only the content pipeline needs; metro.config.cjs points the app's
 * imports of `@smriti/content-schema` here so ajv and the schema files stay out of the bundles.
 * Types still come from the package itself (type imports are erased).
 *
 * Root change needed: a `./runtime` (or `./localize`) export in content-schema would replace this.
 */
export * from '../../../../packages/content-schema/src/constants';
export * from '../../../../packages/content-schema/src/localize';
export * from '../../../../packages/content-schema/src/units';
