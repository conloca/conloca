import { Command } from 'commander';
import { type AssetAddOptions, assetAdd } from './commands/asset-add.js';
import { components } from './commands/components.js';
import { connect } from './commands/connect.js';
import { create } from './commands/create.js';
import { type DataCreateOptions, type DataUpdateOptions, dataCreate, dataUpdate } from './commands/data.js';
import { doctor } from './commands/doctor.js';
import { init } from './commands/init.js';
import { type PageCreateOptions, pageCreate } from './commands/page-create.js';
import { type PageUpdateOptions, pageUpdate } from './commands/page-update.js';
import { routes } from './commands/routes.js';
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
dependencies, tsconfig jsx, prerender under server output, Conloca pages
hidden behind a src/pages file, static pages with no Conloca pages, and
siteStyles. Dependencies that ship a doctor extension (a conloca.doctor field
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
  .command('routes')
  .argument('[path]', 'Project directory', '.')
  .option('--site <site>', 'Site in sites.json to list (default: the first one)')
  .option('--json', 'Report as a single JSON object on stdout')
  .description("List a site's static routes and which are Conloca pages")
  .addHelpText(
    'after',
    `
Lists the static page routes of src/pages next to the site's Conloca pages,
one per route. A route served by both is marked: the src/pages file wins and
hides the Conloca page. Dynamic routes ([slug].astro, content collection
pages) and non-default-locale routes are never listed. Needs an astro.config
in [path]. Read-only: never modifies any file.`,
  )
  .action(async (path: string, options: { site?: string; json?: boolean }) => {
    await routes(path, { site: options.site, json: options.json === true });
  });

program
  .command('components')
  .argument('[path]', 'Project directory', '.')
  .option('--json', 'Print the component manifest as JSON on stdout')
  .description("List the site's Puck components and their fields")
  .addHelpText(
    'after',
    `
Reads the Puck config that conlocaCMS's puckConfigPath names from source,
without running it, and prints one line per component with its fields.
--json prints the manifest the editor and agents use. A config that cannot be
fully read is still an answer: the manifest says what and why. Needs an
astro.config in [path]. Read-only: never modifies any file.`,
  )
  .action(async (path: string, options: { json?: boolean }) => {
    await components(path, { json: options.json === true });
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

/** The Puck content and page-settings metadata flags `page create` and `page update` share. */
function withPageContentOptions(command: Command): Command {
  return command
    .option('--content <source>', "Puck data { root, content, zones } from a JSON file, or '-' for stdin")
    .option('--description <text>', 'Page description (meta.description)')
    .option('--image <ref>', 'Social sharing image (meta.ogImage)')
    .option('--canonical <url>', 'Canonical URL (meta.canonical)')
    .option('--robots <value>', "Robots directive, e.g. 'noindex' (meta.robots)");
}

withPageContentOptions(
  page
    .command('create')
    .argument('[path]', 'Project directory holding the content root', '.')
    .requiredOption('--site <site>', 'Site the page belongs to (a key in sites.json)')
    .requiredOption('--collection <collection>', "Collection directory under the site, e.g. 'pages'")
    .requiredOption('--pathname <pathname>', "Page route, starting with '/'")
    .requiredOption('--title <title>', 'Page title (meta.title)'),
)
  .option('--json', 'Report as a single JSON object on stdout')
  .description("Create a Puck page in the site's default locale")
  .addHelpText(
    'after',
    `
Writes a new .vxjson page file under <content root>/<site>/<collection>, in the
site's default locale from sites.json. The page holds the Puck data --content
points at, or the same empty Puck payload the CMS writes for a new page; the
metadata flags are stored in its meta. Prints the created file path and page
id; --json prints {ok, id, path} instead. Exits 1 when the site is unknown,
the pathname is invalid or already taken, --content is not Puck data, or the
write fails.`,
  )
  .action(async (path: string, options: Omit<PageCreateOptions, 'json'> & { json?: boolean }) => {
    await pageCreate(path, { ...options, json: options.json === true });
  });

withPageContentOptions(
  page
    .command('update')
    .argument('<ref>', "Page id, or its route starting with '/'")
    .argument('[path]', 'Project directory holding the content root', '.')
    .option('--site <site>', 'Site the page belongs to (a key in sites.json)', DEFAULT_SITE_NAME)
    .option('--title <title>', 'Page title (meta.title)'),
)
  .option('--json', 'Report as a single JSON object on stdout')
  .description("Update a page's content or metadata in the site's default locale")
  .addHelpText(
    'after',
    `
Writes only what is given: --content replaces the page's Puck data (Puck pages
only), --title and the metadata flags set those meta fields, and an empty value
(--robots '') clears one. A route like /about/ finds /about. Prints the page
file path and id; --json prints {ok, id, path} instead. Exits 1 when no page
has that id or route, the id is a data entry or fragment, nothing is given to
update, or the write fails.`,
  )
  .action(async (ref: string, path: string, options: Omit<PageUpdateOptions, 'json'> & { json?: boolean }) => {
    await pageUpdate(ref, path, { ...options, json: options.json === true });
  });

const data = program
  .command('data')
  // Keeps the subcommand visible in the top-level command list.
  .usage('<subcommand>')
  .description('Data entry commands');

data
  .command('create')
  .argument('<collection>', "Data collection, e.g. 'settings'")
  .argument('[path]', 'Astro project holding the content root', '.')
  .requiredOption('--name <name>', 'Entry name: letters, digits, - and _')
  .requiredOption('--data <source>', "The entry's data as a JSON object, from a file or '-' for stdin")
  .option('--title <title>', 'Entry title (meta.title), defaults to the name')
  .option('--site <site>', 'Site whose default locale the entry is written in (a key in sites.json)', DEFAULT_SITE_NAME)
  .option('--no-install', 'Do not install the packages the data schemas need; print the command instead')
  .option('--json', 'Report as a single JSON object on stdout')
  .description("Create a data entry in the site's default locale")
  .addHelpText(
    'after',
    `
Writes <content root>/data/<collection>/<name>.<locale>.json holding --data.
A site without data schemas is wired first: schemasPath, assetsPath and the
Typia vite plugin in astro.config, the data collections in the content config,
the starter schema files, and the packages they need. Prints the entry file
path and id; --json prints {ok, id, path, wired?, command?, warnings?}. Warns
when the schemas module declares no such collection. Exits 1 when --data is not
a JSON object, the config needs a hand, the name is taken, or the write fails.`,
  )
  .action(async (collection: string, path: string, options: Omit<DataCreateOptions, 'json'> & { json?: boolean }) => {
    await dataCreate(collection, path, { ...options, json: options.json === true });
  });

data
  .command('update')
  .argument('<collection>', "Data collection, e.g. 'settings'")
  .argument('<ref>', 'Entry id, or its name in the collection')
  .argument('[path]', 'Astro project holding the content root', '.')
  .requiredOption('--data <source>', "The entry's new data as a JSON object, from a file or '-' for stdin")
  .option('--title <title>', 'Entry title (meta.title)')
  .option('--site <site>', 'Site whose default locale the entry is in (a key in sites.json)', DEFAULT_SITE_NAME)
  .option('--json', 'Report as a single JSON object on stdout')
  .description("Replace a data entry's data in the site's default locale")
  .addHelpText(
    'after',
    `
Replaces the entry's data with --data and sets its title when --title is
given. Prints the entry file path and id; --json prints {ok, id, path}. Exits 1
when no entry of the collection has that id or name, the id belongs to other
content, --data is not a JSON object, or the write fails.`,
  )
  .action(
    async (
      collection: string,
      ref: string,
      path: string,
      options: Omit<DataUpdateOptions, 'json'> & { json?: boolean },
    ) => {
      await dataUpdate(collection, ref, path, { ...options, json: options.json === true });
    },
  );

const asset = program
  .command('asset')
  // Keeps the subcommand visible in the top-level command list.
  .usage('<subcommand>')
  .description('Image commands');

asset
  .command('add')
  .argument('<file>', 'The image to add')
  .argument('[path]', 'Astro project holding the content root', '.')
  .option('--folder <folder>', "Folder inside the media folder, e.g. 'team'")
  .option('--alt <text>', 'Alt text the editor shows for the image')
  .option('--no-install', 'Do not install the packages the data schemas need; print the command instead')
  .option('--json', 'Report as a single JSON object on stdout')
  .description("Copy an image into the site's media folder")
  .addHelpText(
    'after',
    `
Copies <file> into the conlocaCMS() assetsPath, as an editor upload does: the
name is lowercased and made URL-safe, a name already taken becomes name-1.ext,
and only web image formats up to 10 MB are taken. A site without data schemas
is wired first, as by 'data create': schemas, the assets folder and the Typia
packages. Prints the reference an image field stores,
e.g. /media/hero.jpg, and the file path; --json prints {ok, ref, path, wired?,
command?}. Exits 1 when the file is not an accepted image, astro.config
computes assetsPath, publicDir or base, or the media folder is not served.`,
  )
  .action(async (file: string, path: string, options: Omit<AssetAddOptions, 'json'> & { json?: boolean }) => {
    await assetAdd(file, path, { ...options, json: options.json === true });
  });

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
