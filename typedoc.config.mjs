/** @type {Partial<import("typedoc").TypeDocOptions>} */
const config = {
  entryPoints: ['index.ts'],
  out: 'docs',
  name: 'crnt',
  theme: 'default',
  hideGenerator: true,
  includeVersion: true,
  searchInComments: true,
  sort: ['kind', 'instance-first', 'alphabetical-ignoring-documents'],
  readme: 'README.md',
  projectDocuments: ['README.md'],
  alwaysCreateEntryPointModule: false,
  exclude: ['**/*.test.ts', 'node_modules/*', 'docs/*', 'dist/*'],
  categoryOrder: ['*', 'Other'],
  excludeExternals: true,
  excludePrivate: true,
  excludeProtected: true,
  validation: {
    notExported: true,
    invalidLink: true,
    notDocumented: false,
  },
  navigation: {
    includeCategories: true,
    includeGroups: false,
  },
  categorizeByGroup: false,
  externalSymbolLinkMappings: {
    // https://typedoc.org/documents/Options.Comments.html#externalsymbollinkmappings
    'bun-types': {
      AbortSignal:
        'https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal',
    },
    typescript: {
      Iterator:
        'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Iterator',
      Iterable:
        'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Iterable',
      AsyncIterator:
        'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncIterator',
      AsyncIterable:
        'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncIterator',
      // Promise doc is a bit noisy.
      // Promise: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise',
    },
    global: {
      // Promise: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise',
    },
  },
  tsconfig: 'tsconfig.json',
};
export default config;
