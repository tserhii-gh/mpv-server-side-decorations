# Gnome-shell extension
This is the fork of the [original rounded-window-corners extension][14] by
@yilozt, which is no longer maintained, and [rounded-window-corners reborn][15] by @flexagoon.

## Features

- Works with Gnome 46+
- Custom border radius and clip paddings for MPV window
- Custom shadow for MPV window with rounded corners
- [Superelliptical][1] shape for rounded corners, thanks to [@YuraIz][2]
- A simple reset preferences dialog


## Notes

- The rounded corner effect for windows is based on this [shader][4] from
  mutter project
- TypeScript support for GJS is powered by [gjsify](https://gjsify.org/)

## Installation

1. Install the dependencies:
    - Node.js
    - npm
    - [just](https://just.systems)

    Those packages are available in the repositories of most linux distros, so
    you can simply install them with your package manager.

2. Build the extension

    ```bash
    git clone https://github.com/tserhii-gh/mpv-server-side-decorations
    cd mpv-server-side-decorations
    just install
    ```

After this, the extension will be installed to
`~/.local/share/gnome-shell/extensions`.


## Development

Here are the avaliable `just` commands (run `just --list` to see this message):

```bash
Available recipes:
    build   # Compile the extension and all resources
    clean   # Delete the build directory
    install # Build and install the extension from source
    pack    # Build and pack the extension
```

<!-- links -->

[1]: https://en.wikipedia.org/wiki/Superellipse
[2]: https://github.com/YuraIz
[3]: https://extensions.gnome.org/extension/3740/compiz-alike-magic-lamp-effect/
[4]: https://gitlab.gnome.org/GNOME/mutter/-/blob/main/src/compositor/meta-background-content.c#L138
[6]: https://user-images.githubusercontent.com/32430186/181902857-d4d10740-82fe-4941-b064-d436b9ea7317.png
[7]: https://extensions.gnome.org/extension/5237/rounded-window-corners/
[8]: https://github.com/yilozt/rounded-window-corners/releases
[9]: https://github.com/yilozt/rounded-window-corners/actions/workflows/pack.yml
[10]: https://img.shields.io/github/v/release/yilozt/rounded-window-corners?style=flat-square
[11]: https://img.shields.io/github/actions/workflow/status/yilozt/rounded-window-corners/pack.yml?branch=main&style=flat-square
[12]: https://hosted.weblate.org/widgets/rounded-window-corners/-/rounded-window-corners/multi-auto.svg
[13]: https://hosted.weblate.org/engage/rounded-window-corners/
[14]: https://github.com/yilozt/rounded-window-corners
[15]: https://github.com/flexagoon/rounded-window-corners
