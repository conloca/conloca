import { Command } from 'commander';
import { connect } from './commands/connect.js';
import { create } from './commands/create.js';
import { doctor } from './commands/doctor.js';
import { init } from './commands/init.js';
import { pageCreate } from './commands/page-create.js';
import { DEFAULT_SITE_NAME, printSetupNextSteps, setup } from './commands/setup.js';
import { PACKAGE_MANAGERS } from './lib/package-manager.js';

const program = new Command();

program
  .name('conloca')
  // Commander's default is `conloca [options] [command]`. The command comes
  // first in every documented invocation, so the usage line says so too.
  .usage('<command> [options]')
  .helpOption('-h, --help', 'Show this help message')
  .addHelpText('after', "\nRun 'conloca <command> --help' for help on a single command.");

program
  .command('init')
  .argument('<directory>', 'Where the content root is created')
  .argument('<site>', 'Site name recorded in sites.json')
  .description('Initialize a new Conloca content structure')
  .addHelpText(
    'after',
    `
Creates the content structure: <directory>/content with a pages folder for
<site>, a shared fragments folder, and sites.json. Pointing it at a directory
already named 'content' uses that directory as the content root, unless it
holds a content/ directory of its own.`,
  )
  .action(async (directory: string, site: string) => {
    await init(directory, site);
  });

program
  .command('create')
  .argument('<directory>', 'Empty directory for the new site (created if missing)')
  .option('--site <site>', 'Site name recorded in sites.json', DEFAULT_SITE_NAME)
  .option('--pm <manager>', `Package manager: ${PACKAGE_MANAGERS.join(', ')} (default: the one that launched the CLI)`)
  .option('--no-install', 'Skip installing dependencies')
  .option('--no-git', 'Skip git init')
  .option('--json', 'Report as a single JSON object on stdout')
  .description('Create a new Astro site with Conloca CMS wired in')
  .addHelpText(
    'after',
    `
Writes a complete Astro project into <directory>: package.json, astro.config
with conlocaCMS wired, tsconfig, content config, starter components, a first
page, the agent skill and a CI workflow that runs the doctor and the build.
Then installs dependencies, initialises git, and runs the doctor on the result.
Refuses a non-empty directory — for an existing site use 'conloca connect'.`,
  )
  .action(
    async (
      directory: string,
      options: { site: string; pm?: string; install: boolean; git: boolean; json?: boolean },
    ) => {
      await create(directory, {
        site: options.site,
        pm: options.pm,
        install: options.install,
        git: options.git,
        json: options.json === true,
      });
    },
  );

program
  .command('doctor')
  .argument('[path]', 'Project directory to check', '.')
  .option('--json', 'Report as a single JSON object on stdout')
  .option('--live', 'Let doctor extensions contact the services the project configures')
  .description('Check the content directory for problems')
  .addHelpText(
    'after',
    `
Runs read-only health checks over the project in [path]: sites.json is present
and complete, every site has its pages directory, and every content file
indexes cleanly. When an astro.config is present it also checks the Astro
wiring: content config, conlocaCMS import and options, react() order, peer
dependencies, tsconfig jsx, prerender under server output, and home-page
shadowing. Dependencies that ship a doctor extension (a conloca.doctor field
in their package.json) add their own checks; --live lets those extensions
reach the services the project configures, otherwise they stay offline.
Never modifies any file. Exits 1 when an error is found; warnings alone exit
0. Pointing it at a directory already named 'content' uses that directory as
the content root, unless it holds a content/ directory of its own. Replaces
the retired verify command.`,
  )
  .action(async (path: string, options: { json?: boolean; live?: boolean }) => {
    await doctor(path, { json: options.json === true, live: options.live === true });
  });

program
  .command('connect')
  .argument('[path]', 'Folder of the Astro site, or of the repository holding it', '.')
  .option('--project <dir>', 'Astro project to set up, when the repository has several')
  .option('--site-url <url>', 'The address the site is deployed at, when astro.config sets no `site`')
  .option('--yes', 'Accept every change without asking (no terminal needed)')
  .option('--dry-run', 'Show the changes, write nothing')
  .option('--no-install', 'Do not install packages; print the command instead')
  .option('--no-build', 'Skip the local build check')
  .option('--json', 'One JSON report on stdout')
  .description("Set up an Astro site's editor page for your workspace editor")
  .addHelpText(
    'after',
    `
Adds @conloca/astro-cms, @conloca/cloud-astro and their React peers with the
project's own package manager, wires react(), conlocaCMS() and conlocaCloud()
into astro.config, writes the site's domain into sites.json, allows the
workspace editor to frame the editor page where a committed header forbids
it, builds the site once to prove the editor page is there, and removes the
old build key from workflows. Every change is shown as a diff first; in a
terminal it asks once, --yes accepts, and without a terminal or --yes nothing
is written. A value you set yourself is kept and reported as "differs".
Never commits, pushes or deploys. Exits 0 when done, 1 when a step failed,
2 when a step needs you.`,
  )
  .action(
    async (
      path: string,
      options: {
        project?: string;
        siteUrl?: string;
        yes?: boolean;
        dryRun?: boolean;
        install: boolean;
        build: boolean;
        json?: boolean;
      },
    ) => {
      await connect(path, {
        project: options.project,
        siteUrl: options.siteUrl,
        yes: options.yes === true,
        dryRun: options.dryRun === true,
        install: options.install,
        build: options.build,
        json: options.json === true,
      });
    },
  );

const page = program
  .command('page')
  // Keeps the subcommand visible in the top-level command list.
  .usage('<subcommand>')
  .description('Page management commands');

page
  .command('create')
  .argument('[path]', 'Project directory holding the content root', '.')
  .requiredOption('--site <site>', 'Site the page belongs to (a key in sites.json)')
  .requiredOption('--collection <collection>', "Collection directory under the site, e.g. 'pages'")
  .requiredOption('--pathname <pathname>', "Page route, starting with '/'")
  .requiredOption('--title <title>', 'Page title (meta.title)')
  .option('--json', 'Report as a single JSON object on stdout')
  .description("Create an empty Puck page in the site's default locale")
  .addHelpText(
    'after',
    `
Writes a new .vxjson page file under <content root>/<site>/<collection>, with
the same empty Puck payload the CMS writes for a new page, in the site's
default locale from sites.json. Prints the created file path and page id;
--json prints {ok, id, path} instead. Exits 1 when the site is unknown, the
pathname is invalid or already taken, or the write fails.`,
  )
  .action(
    async (
      path: string,
      options: { site: string; collection: string; pathname: string; title: string; json?: boolean },
    ) => {
      await pageCreate(path, {
        site: options.site,
        collection: options.collection,
        pathname: options.pathname,
        title: options.title,
        json: options.json === true,
      });
    },
  );

const astro = program
  .command('astro')
  // Keeps the subcommand visible in the top-level command list.
  .usage('<subcommand>')
  .description('Astro framework integration commands');

astro
  .command('setup')
  .argument('[path]', 'Project directory to set up', '.')
  .description('Set up Astro integration (components, Puck config)')
  .addHelpText(
    'after',
    `
Writes the starter components, Puck config and data schemas into [path], then
prints the astro.config options that load them.`,
  )
  .action(async (path: string) => {
    await setup(path);
    printSetupNextSteps();
  });

async function main() {
  try {
    // A bare `conloca` is a request for the overview, not a usage error, so it
    // prints to stdout and exits 0. Commander would treat it as an error.
    if (process.argv.length <= 2) {
      program.outputHelp();
      process.exit(0);
    }

    await program.parseAsync(process.argv);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
