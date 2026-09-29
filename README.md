# Simply UTAM

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Simply UTAM is a set of libraries built by [SimplySF](https://github.com/SimplySF) for writing
[UTAM](https://utam.dev/) UI tests against Salesforce: logging the test browser in to an org the
Salesforce CLI has already authorized, opening Lightning pages directly, and seeing what a UTAM
locator actually resolved to.

## Packages

| Package                                                   | Description                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| [`@simplysf/simply-utam`](packages/simply-utam)           | Developer CLI executable and convenience re-exports                  |
| [`@simplysf/simply-utam-core`](packages/simply-utam-core) | Org authentication, Lightning navigation, and UTAM debugging helpers |

## Installation

```sh
npm install --save-dev @simplysf/simply-utam-core
# or for the developer CLI:
npm install --save-dev @simplysf/simply-utam
```

Requires Node.js 22 or later. See the [package README](packages/simply-utam-core/README.md) for usage
and the API reference.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the repo structure, how to set
up and build the project, our commit conventions, and how to submit a pull request. Please also read
our [Code of Conduct](CODE_OF_CONDUCT.md).

## Issues

Please report bugs or request features by [opening an issue](https://github.com/SimplySF/simply-utam/issues)
in this repository.

## License

Licensed under the [Apache-2.0](LICENSE.txt) license.
