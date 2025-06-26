/**
 * Zero-allocation JSON whitespace-skipping stream transform
 * Skips whitespace outside of JSON strings, preserving whitespace inside strings
 * Optimized to process multiple bytes at once when possible
 */
export class JsonWhitespaceSkippingView {
  private inString = false;
  private escaped = false;
  private singleByte = new Uint8Array(1); // Reused allocation for single bytes

  constructor(private downstream: { update(data: Uint8Array): void }) {}

  /**
   * Process a single byte from JSON stream
   * @param byte - The byte to process
   */
  updateByte(byte: number): void {
    let shouldInclude = false;

    if (this.inString) {
      // Inside string: always include the byte
      shouldInclude = true;

      if (this.escaped) {
        this.escaped = false;
      } else if (byte === 0x5c) {
        // backslash
        this.escaped = true;
      } else if (byte === 0x22) {
        // quote
        this.inString = false;
      }
    } else {
      // Outside string: check for string start or skip whitespace
      if (byte === 0x22) {
        // quote
        this.inString = true;
        shouldInclude = true;
      } else if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
        // Not whitespace, include it
        shouldInclude = true;
      }
      // Skip whitespace outside strings
    }

    if (shouldInclude) {
      this.singleByte[0] = byte;
      this.downstream.update(this.singleByte);
    }
  }

  /**
   * Process a buffer range with simple batching
   * Collects consecutive bytes that should be included
   * @param buffer - The buffer to process
   * @param start - Start position (inclusive)
   * @param end - End position (exclusive)
   */
  updateBuffer(buffer: Uint8Array, start = 0, end = buffer.length): void {
    let pos = start;
    let runStart = start;

    while (pos < end) {
      const byte = buffer[pos];
      let shouldInclude = false;

      if (this.inString) {
        // Inside string: always include
        shouldInclude = true;

        if (this.escaped) {
          this.escaped = false;
        } else if (byte === 0x5c) {
          // backslash
          this.escaped = true;
        } else if (byte === 0x22) {
          // quote - end of string
          this.inString = false;
        } else {
          // Regular character - use indexOf to skip to next quote
          pos++;
          let searchPos = pos;

          while (searchPos < end) {
            const quotePos = buffer.indexOf(0x22, searchPos);
            if (quotePos === -1 || quotePos >= end) {
              // No more quotes
              pos = end;
              break;
            }

            // Count consecutive backslashes before the quote
            let backslashCount = 0;
            let checkPos = quotePos - 1;
            while (checkPos >= 0 && buffer[checkPos] === 0x5c) {
              backslashCount++;
              checkPos--;
            }

            if (backslashCount % 2 === 0) {
              // Even backslashes (including 0) - quote is not escaped
              pos = quotePos + 1;
              this.inString = false;
              break;
            }
            // Odd backslashes - quote is escaped, continue searching
            searchPos = quotePos + 1;
          }
          continue; // Skip the pos++ at the bottom
        }
      } else {
        // Outside string
        if (byte === 0x22) {
          // quote - start of string
          this.inString = true;
          shouldInclude = true;
        } else if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
          // Not whitespace
          shouldInclude = true;
        }
      }

      if (shouldInclude) {
        // Continue the run
        pos++;
      } else {
        // End of run - send what we have
        if (pos > runStart) {
          this.downstream.update(buffer.subarray(runStart, pos));
        }
        pos++;
        runStart = pos;
      }
    }

    // Send any remaining bytes
    if (pos > runStart) {
      this.downstream.update(buffer.subarray(runStart, pos));
    }
  }

  /**
   * Reset the parser state
   */
  reset(): void {
    this.inString = false;
    this.escaped = false;
  }
}
