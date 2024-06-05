// imports.gi
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';

// gnome modules
import {PACKAGE_VERSION} from 'resource:///org/gnome/shell/misc/config.js';

// local modules
import {constants} from './constants.js';
import {_log, _logError} from './log.js';

// types
import type Clutter from 'gi://Clutter';
import type * as types from './types.js';

// --------------------------------------------------------------- [end imports]

export const computeWindowContentsOffset = (
    meta_window: Meta.Window,
): [number, number, number, number] => {
    const bufferRect = meta_window.get_buffer_rect();
    const frameRect = meta_window.get_frame_rect();
    return [
        frameRect.x - bufferRect.x,
        frameRect.y - bufferRect.y,
        frameRect.width - bufferRect.width,
        frameRect.height - bufferRect.height,
    ];
};

/**
 * Get scale factor of a Meta.window, if win is undefined, return
 * scale factor of current monitor
 */
export const WindowScaleFactor = (win?: Meta.Window) => {
    const features = Gio.Settings.new('org.gnome.mutter').get_strv(
        'experimental-features',
    );

    // When enable fractional scale in Wayland, return 1
    if (
        Meta.is_wayland_compositor() &&
        features.includes('scale-monitor-framebuffer')
    ) {
        return 1;
    }

    const monitor_index = win
        ? win.get_monitor()
        : global.display.get_current_monitor();
    return global.display.get_monitor_scale(monitor_index);
};

/**
 * Decide whether windows should have rounded corners when it has been
 * maximized & fullscreen according to RoundedCornersCfg
 */
export function ShouldHasRoundedCorners(
    win: Meta.Window,
    cfg: types.RoundedCornersCfg,
): boolean {
    let should_has_rounded_corners = false;

    const maximized = win.maximizedHorizontally || win.maximizedVertically;
    const fullscreen = win.fullscreen;

    should_has_rounded_corners =
        !(maximized || fullscreen) ||
        (maximized && cfg.keep_rounded_corners.maximized) ||
        (fullscreen && cfg.keep_rounded_corners.fullscreen);

    return should_has_rounded_corners;
}

/**
 * @returns Current version of gnome shell
 */
export function shell_version(): number {
    return Number.parseFloat(PACKAGE_VERSION);
}

/**
 * Get Rounded corners effect from a window actor
 */
export function get_rounded_corners_effect(
    actor: Meta.WindowActor,
): Clutter.Effect | null {
    const win = actor.metaWindow;
    const name = constants.ROUNDED_CORNERS_EFFECT;
    return win.get_client_type() === Meta.WindowClientType.X11
        ? actor.firstChild.get_effect(name)
        : actor.get_effect(name);
}
