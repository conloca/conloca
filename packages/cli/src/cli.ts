import { parseArgs } from 'util';
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
      },
      allowPositionals: true,
    });

    if (values.help || positionals.length === 0) {
      console.log(`Usage: conloca <command> [options]

Commands:
  verify <directory>    Verify content in the specified directory

Options:
  -h, --help           Show this help message`);
      process.exit(0);
    }

    const command = positionals[0];

    switch (command) {
      case 'verify':
        if (positionals.length < 2) {
          console.error('Error: verify command requires a directory argument');
          process.exit(1);
        }
        await verify(positionals[1]);
        break;
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
