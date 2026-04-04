/**
 * Shared constants for kajabi-cli.
 */

export const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

export const KAJABI_CLI_DIR = process.env.HOME
  ? `${process.env.HOME}/.kajabi-cli`
  : '.kajabi-cli';
