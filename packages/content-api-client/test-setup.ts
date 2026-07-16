// Register Happy-DOM globals
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

// Add jest-dom matchers
import { expect } from 'bun:test';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// NOTE: Don't add afterEach(cleanup) here due to Bun issue with screen export
// See: https://github.com/testing-library/react-testing-library/issues/1348
