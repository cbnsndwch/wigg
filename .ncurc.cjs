/**
 * @type {import('npm-check-updates').RunOptions}
 */
module.exports = {
    reject: [
        // we'll upgrade Node manually when it's time
        '@types/node',

        // it takes time...
        'typescript'
    ],

    packageManager: 'pnpm',

    // workspaces mode (deep won't work here)
    workspaces: true
};
