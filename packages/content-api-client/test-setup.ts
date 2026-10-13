// Register Happy-DOM globals
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

// NOTE: Don't add afterEach(cleanup) here due to Bun issue with screen export
// See: https://github.com/testing-library/react-testing-library/issues/1348
