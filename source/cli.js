#!/usr/bin/env node
'use strict';
const meow = require('meow');
const updateNotifier = require('update-notifier');
const pluginpub = require('./index');

const cli = meow(`
	Usage
	  $ pluginpub [major | minor | patch | premajor | preminor | prepatch | prerelease | <version>] (Default: patch)

	Options
	  --any-branch    Allow publishing from any branch
	  --skip-cleanup  Skips cleanup of node_modules
	  --yolo          Skips cleanup and testing

	Examples
	  $ pluginpub
	  $ pluginpub patch
	  $ pluginpub 1.0.2
`);

updateNotifier({pkg: cli.pkg}).notify();

pluginpub(cli.input[0], cli.flags)
	.then(pkg => {
		console.log(`\n ${pkg.name} ${pkg.version} published`);
	})
	.catch(err => {
		console.error(`\n${err.message}`);
		process.exit(1);
	});
