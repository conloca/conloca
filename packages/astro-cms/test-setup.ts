// Register Happy-DOM globals
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

// Add jest-dom matchers
import { expect } from 'bun:test';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);
