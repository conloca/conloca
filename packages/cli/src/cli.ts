import { parseArgs } from 'util';
import { init } from './commands/init';
import { setup } from './commands/setup';
import { verify } from './commands/verify';

async function main() {
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: {
        help: {
          type: 'boolean',
          short: 'h',
        },
        site: {
          type: 'string',
          short: 's',
        },
      },
      allowPositionals: true,
    });

    if (values.help || positionals.length === 0) {
      console.log(`Usage: conloca <command> [options]

Commands:
  init <directory> <site>      Initialize a new Conloca content structure
  verify <directory>           Verify content in the specified directory
  astro <subcommand> [options] Astro framework integration commands

Astro Subcommands:
  astro setup [path]           Set up Astro integration (routes, components, config)

Options:
  -h, --help                   Show this help message
  -s, --site <name>            Site name to target (default: default)`);
      process.exit(0);
    }

    const command = positionals[0];

    switch (command) {
      case 'init':
        if (positionals.length < 2) {
          console.error('Error: init command requires a directory argument');
          process.exit(1);
        }
        if (positionals.length < 3) {
          console.error('Error: init command requires a site name argument');
          process.exit(1);
        }
        await init(positionals[1], positionals[2]);
        break;

      case 'verify':
        if (positionals.length < 2) {
          console.error('Error: verify command requires a directory argument');
          process.exit(1);
        }
        await verify(positionals[1]);
        break;

      case 'astro': {
        const subcommand = positionals[1];
        if (!subcommand) {
          console.error(`Error: astro command requires a subcommand
Available subcommands:
  setup [path]    Set up Astro integration (routes, components, config)`);
          process.exit(1);
        }

        switch (subcommand) {
          case 'setup': {
            const projectPath = positionals[2] || '.';
            const siteName = typeof values.site === 'string' && values.site.length > 0 ? values.site : 'default';
            await setup(projectPath, siteName);
            break;
          }

          default:
            console.error(`Error: Unknown astro subcommand '${subcommand}'`);
            process.exit(1);
        }
        break;
      }

      default:
        console.error(`Error: Unknown command '${command}'`);
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
