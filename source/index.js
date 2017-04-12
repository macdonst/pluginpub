const fs = require('fs');
const semver = require('semver');
const execa = require('execa');
const del = require('del');
const pify = require('pify');
const Listr = require('listr');
const split = require('split');
require('any-observable/register/rxjs-all');
const Observable = require('any-observable');
const streamToObservable = require('stream-to-observable');
const xml2js = require('xml2js');
const path = require('path');
const dateFormat = require('dateformat');

const fsP = pify(fs);
let oldVersion = null;

const exec = (cmd, args) => {
	// Use `Observable` support if merged https://github.com/sindresorhus/execa/pull/26
	const cp = execa(cmd, args);

	return Observable.merge(
		streamToObservable(cp.stdout.pipe(split()), {await: cp}),
		streamToObservable(cp.stderr.pipe(split()), {await: cp})
	).filter(Boolean);
};

const gitTasks = opts => {
	const tasks = [
		{
			title: 'Check current branch',
			task: () => execa.stdout('git', ['symbolic-ref', '--short', 'HEAD']).then(branch => {
				if (branch !== 'master') {
					throw new Error('Not on `master` branch. Use --any-branch to publish anyway.');
				}
			})
		},
		{
			title: 'Check local working tree',
			task: () => execa.stdout('git', ['status', '--porcelain']).then(status => {
				if (status !== '') {
					throw new Error('Unclean working tree. Commit or stash changes first.');
				}
			})
		},
		{
			title: 'Fetch remote changes',
			task: () => execa('git', ['fetch'])
		},
		{
			title: 'Check remote history',
			task: () => execa.stdout('git', ['rev-list', '--count', '--left-only', '@{u}...HEAD']).then(result => {
				if (result !== '0') {
					throw new Error('Remote history differ. Please pull changes.');
				}
			})
		}
	];

	if (opts.anyBranch) {
		tasks.shift();
	}

	return new Listr(tasks);
};

const pluginTasks = version => {
  const commitMsg = `:bookmark: Bumping plugin version to ${version}`;
	const tasks = [
    {
      title: 'Update plugin.xml',
      task: () => updatePluginXml(version)
    },
    {
      title: 'Stage plugin.xml',
      task: () => exec('git', ['add', 'plugin.xml'])
    },
    {
      title: 'Commit plugin.xml',
      task: () => exec('git', ['commit', '-m', commitMsg])
    }
	];

	return new Listr(tasks);
};

const updatePluginXml = (version) => {
  return new Promise(function(resolve, reject) {
    const parser = new xml2js.Parser();
    const pluginPath = path.resolve('./');
    console.log(pluginPath + '/plugin.xml');
    fs.readFile(pluginPath + '/plugin.xml', function(err, data) {
      if (err) {
        console.error(err);
        reject();
      };

      parser.parseString(data, function (err, result) {
        oldVersion = result.plugin.$.version;
        result.plugin.$.version = version;

        const builder = new xml2js.Builder();
        const xml = builder.buildObject(result);

        fs.writeFile('plugin.xml', xml, function (err) {
          if (err) {
            console.error(err);
            reject();
          }
          resolve();
        });
      });
    });
	});
}

const generateChangelog = version => {
  console.log(oldVersion);
  const commitMsg = `Updating CHANGELOG`;
  const tasks = [
    {
      title: 'Update CHANGELOG.md',
      task: () => updateChangelog(version)
    },
    {
      title: 'Stage CHANGELOG.md',
      task: () => exec('git', ['add', 'CHANGELOG.md'])
    },
    {
      title: 'Commit CHANGELOG.md',
      task: () => exec('git', ['commit', '-m', commitMsg])
    },
    {
      title: 'Push CHANGELOG.md',
      task: () => exec('git', ['push', 'origin', 'master'])
    }
  ];
  return new Listr(tasks);
}

const updateChangelog = (version) => {
  return new Promise(function(resolve, reject) {
    const pluginPath = path.resolve('./');
    console.log(pluginPath + '/CHANGELOG.md');
    fs.readFile(pluginPath + '/CHANGELOG.md', 'utf-8', function(err, data) {
      if (data) {
        data = data.substring(data.indexOf('##'));
      }

      const fetchURL = "Fetch URL";
      execa.stdout('git', ['remote', 'show', 'origin', '-n']).then(gitUrl => {
        const begin = gitUrl.indexOf('Fetch URL: https://github.com/') + 30;
        const end = gitUrl.indexOf('.git', begin);
        const orgRepo = gitUrl.substring(begin, end);
        const versions = `v${oldVersion}...v${version}`;
        const prettyFormat = `--pretty=format:- %s [view commit](http://github.com/${orgRepo}/commit/%H)`;
				const today = dateFormat(new Date(), 'yyyy-MM-dd');
        execa.stdout('git', ['log', versions, prettyFormat]).then(result => {
          const changelogData = `# Change Log

## [v${version}](https://github.com/${orgRepo}/tree/v${version}) (${today})
[Full Changelog](https://github.com/${orgRepo}/compare/${versions})

${result}

${data}`;
          fs.writeFile('CHANGELOG.md', changelogData, function (err) {
            if (err) {
              console.error(err);
              reject();
            }
            resolve();
          });
  			}).catch(error => {
          console.error(err);
          reject();
        })
			});
    });
	});
}

module.exports = (input, opts) => {
	input = input || '';
	opts = opts || {};

	const runTests = !opts.yolo;
	const runCleanup = !opts.skipCleanup && !opts.yolo;

	if (!semver.valid(input)) {
		return Promise.reject(new Error(`Version should be a valid semver version.`));
	}

	if (semver.gte(process.version, '6.0.0')) {
		return Promise.reject(new Error('You should not publish when running Node.js 6. Please downgrade and publish again. https://github.com/npm/npm/issues/5082'));
	}

	const tasks = new Listr([
		{
			title: 'Git',
			task: () => gitTasks(opts)
		}
	]);

	if (runCleanup) {
		tasks.add([
			{
				title: 'Cleanup',
				task: () => del('node_modules')
			},
			{
				title: 'Installing dependencies',
				task: () => exec('npm', ['install'])
			}
		]);
	}

	if (runTests) {
		tasks.add({
			title: 'Running tests',
			task: () => exec('npm', ['test'])
		});
	}

	tasks.add([
    {
      title: 'plugin.xml',
      task: () => pluginTasks(input)
    },
    {
			title: 'Bumping version',
			task: () => exec('npm', ['version', input])
		},
		{
			title: 'Publishing package',
			task: () => exec('npm', ['publish'])
		},
		{
			title: 'Pushing tags',
			task: () => exec('git', ['push', '--follow-tags'])
		},
    {
  		title: 'Generate CHANGELOG',
  		task: function task() {
  			return generateChangelog(input);
  		}
  	}
	]);

	return tasks.run()
		.then(() => fsP.readFile('package.json', 'utf8'))
		.then(JSON.parse);
}
