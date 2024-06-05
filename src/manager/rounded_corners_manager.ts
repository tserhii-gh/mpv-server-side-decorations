// imports.gi
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

// local modules
import {ClipShadowEffect} from '../effect/clip_shadow_effect.js';
import {RoundedCornersEffect} from '../effect/rounded_corners_effect.js';
import {constants} from '../utils/constants.js';
import {_log} from '../utils/log.js';
import {settings} from '../utils/settings.js';
import * as types from '../utils/types.js';
import * as UI from '../utils/ui.js';

// types, those import statements will be removed in output javascript files.
import type {SchemasKeys} from '../utils/settings.js';
import type {EffectManager, ExtensionsWindowActor} from '../utils/types.js';
type RoundedCornersEffectType = InstanceType<typeof RoundedCornersEffect>;

// --------------------------------------------------------------- [end imports]

export class RoundedCornersManager implements EffectManager {
    enabled = true;

    /** Rounded corners settings */
    private global_rounded_corners = settings().global_rounded_corner_settings;

    // ---------------------------------------------------------- [public methods]

    on_add_effect(actor: ExtensionsWindowActor): void {
        _log(`opened: ${actor?.metaWindow.title}: ${actor}`);

        const win = actor.metaWindow;

        // If application failed check, then just return.
        if (!this._should_enable_effect(win)) {
            return;
        }

        // Add rounded corners shader to window
        this._actor_to_rounded(actor)?.add_effect_with_name(
            constants.ROUNDED_CORNERS_EFFECT,
            new RoundedCornersEffect(),
        );

        // Turn off original shadow for ssd x11 window.
        // - For ssd client in X11, shadow is drew by window manager
        // - For csd client, shadow is drew by application itself, it has been cut
        //   out by rounded corners effect
        if (actor.shadow_mode !== undefined) {
            actor.shadow_mode = Meta.ShadowMode.FORCED_OFF;
        }
        // So we have to create an shadow actor for rounded corners shadows
        const shadow = this._create_shadow(actor);
        // Bind properties between shadow and window
        const flag = GObject.BindingFlags.SYNC_CREATE;
        for (const prop of [
            'pivot-point',
            'translation-x',
            'translation-y',
            'scale-x',
            'scale-y',
        ]) {
            actor.bind_property(prop, shadow, prop, flag);
        }
        // Store visible binding so that we can control the visible of shadow
        // in some time.
        const prop = 'visible';
        const visible_binding = actor.bind_property(prop, shadow, prop, flag);

        // Store shadow, app type, visible binding, so that we can query them later
        actor.__rwc_rounded_window_info = {
            shadow,
            visible_binding,
            unminimized_timeout_id: 0,
        };
    }

    on_remove_effect(actor: ExtensionsWindowActor): void {
        // Remove rounded corners effect
        const name = constants.ROUNDED_CORNERS_EFFECT;
        this._actor_to_rounded(actor)?.remove_effect_by_name(name);

        // Restore shadow for x11 windows
        if (actor.shadow_mode) {
            actor.shadow_mode = Meta.ShadowMode.AUTO;
        }

        // Remove shadow actor
        const shadow = actor.__rwc_rounded_window_info?.shadow;
        if (shadow) {
            global.windowGroup.remove_child(shadow);
            shadow.clear_effects();
            shadow.destroy();
        }

        // Remove all timeout handler
        const timeout_id =
            actor.__rwc_rounded_window_info?.unminimized_timeout_id;
        if (timeout_id) {
            GLib.source_remove(timeout_id);
        }
        delete actor.__rwc_rounded_window_info;
    }

    on_minimize(actor: ExtensionsWindowActor): void {
        const info = actor.__rwc_rounded_window_info;
        const binding = info?.visible_binding;
        const shadow = info?.shadow;
        if (shadow && binding) {
            binding.unbind();
            shadow.visible = false;
        }
    }

    on_unminimize(actor: ExtensionsWindowActor): void {
        this._restore_shadow(actor);

        // Requeue layout after 300ms
        if (actor.firstChild && actor.__rwc_rounded_window_info) {
            const info = actor.__rwc_rounded_window_info;

            // Clear prev handler
            let id = info.unminimized_timeout_id;
            if (id) {
                GLib.source_remove(id);
            }
            id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                actor.firstChild.queue_relayout();
                return false;
            });

            // update handler, it will be clear when window is closed
            info.unminimized_timeout_id = id;
        }
    }

    on_switch_workspace(actor: types.ExtensionsWindowActor) {
        this._restore_shadow(actor);
    }

    on_restacked(actor: ExtensionsWindowActor): void {
        // When windows restacked, change order of shadow actor too
        if (!actor.visible) {
            return;
        }
        const shadow = actor.__rwc_rounded_window_info?.shadow;
        if (shadow) {
            global.windowGroup.set_child_below_sibling(shadow, actor);
        }
    }

    on_size_changed(actor: ExtensionsWindowActor): void {
        const win = actor.metaWindow;

        const window_info = actor.__rwc_rounded_window_info;
        // Get rounded corners effect from window actor
        const effect = this._actor_to_rounded(actor)?.get_effect(
            constants.ROUNDED_CORNERS_EFFECT,
        ) as RoundedCornersEffectType | null;
        if (!(effect && window_info)) {
            return;
        }

        // Skip rounded corners when window is fullscreen & maximize
        const cfg = this._get_rounded_corners_cfg();
        const should_rounded = UI.ShouldHasRoundedCorners(win, cfg);

        if (!should_rounded && effect.enabled) {
            _log(
                'Disable rounded corners effect for maximized window',
                win.title,
            );
            effect.enabled = false;
            this.on_focus_changed(actor);
            return;
        }
        // Restore Rounded effect when un-maximized
        if (should_rounded && !effect.enabled) {
            _log('Restore rounded effect for maximized window', win.title);
            effect.enabled = true;
            this.on_focus_changed(actor);
        }

        // Cache the offset, so that we can calculate this value once
        const content_offset_of_win = UI.computeWindowContentsOffset(win);

        // When size changed. update uniforms for window
        effect.update_uniforms(
            UI.WindowScaleFactor(win),
            cfg,
            this._compute_bounds(actor, content_offset_of_win),
            {
                width: settings().border_width,
                color: settings().border_color,
            },
        );

        // Update BindConstraint for shadow
        const shadow = window_info.shadow;
        const offsets = this._compute_shadow_actor_offset(
            actor,
            content_offset_of_win,
        );
        const constraints = shadow.get_constraints();
        constraints.forEach((constraint, i) => {
            if (constraint instanceof Clutter.BindConstraint) {
                constraint.offset = offsets[i];
            }
        });
    }

    on_focus_changed(actor: ExtensionsWindowActor): void {
        const win = actor.metaWindow;
        const shadow = actor.__rwc_rounded_window_info?.shadow;
        if (!shadow) {
            return;
        }

        const shadow_settings = win.appears_focused
            ? settings().focused_shadow
            : settings().unfocused_shadow;

        const {border_radius, padding} = this._get_rounded_corners_cfg();

        this._update_shadow_actor_style(
            win,
            shadow,
            border_radius,
            shadow_settings,
            padding,
        );
    }

    on_settings_changed(key: SchemasKeys): void {
        switch (key) {
            case 'focused-shadow':
            case 'unfocused-shadow':
                this._update_all_shadow_actor_style();
                break;
            case 'global-rounded-corner-settings':
            case 'border-color':
            case 'border-width':
                this._update_all_rounded_corners_settings();
                break;
            default:
        }
    }

    // --------------------------------------------------------- [private methods]

    private _restore_shadow(actor: ExtensionsWindowActor) {
        const info = actor.__rwc_rounded_window_info;
        if (!info) {
            return;
        }
        const prop = 'visible';
        const flag = GObject.BindingFlags.SYNC_CREATE;
        info.visible_binding = actor.bind_property(
            prop,
            info.shadow,
            prop,
            flag,
        );
    }

    /**
     * Check whether a window should be enable rounded corners effect
     * @param win Meta.Window to test
     */
    private _should_enable_effect(
        win: Meta.Window,
    ): boolean {
        // DING (Desktop Icons NG) is a extensions that create a gtk
        // application to show desktop grid on background, we need to
        // skip it coercively.
        // https://extensions.gnome.org/extension/2087/desktop-icons-ng-ding/
        if (win.gtkApplicationId === 'com.rastersoft.ding') {
            return false;
        }

        // Skip all except MPV player window.
        const wm_class_instance = win.get_wm_class_instance();
        if (wm_class_instance == null) {
            _log(`Warning: wm_class_instance of ${win}: ${win.title} is null`);
            return false;
        }
        if (wm_class_instance != 'mpv') {
            return false;
        }

        // Check type of window, only need to add rounded corners to normal
        // window and dialog.
        const normal_type = [
            Meta.WindowType.NORMAL,
            Meta.WindowType.DIALOG,
            Meta.WindowType.MODAL_DIALOG,
        ].includes(win.windowType);
        if (!normal_type) {
            return false;
        }

        return true;
    }

    /**
     * return Clutter.Actor that should be add rounded corners,
     * In Wayland, we will add rounded corners effect to WindowActor
     * In XOrg, we will add rounded corners effect to WindowActor.first_child
     */
    private _actor_to_rounded(actor: Meta.WindowActor): Clutter.Actor | null {
        const type = actor.metaWindow.get_client_type();
        return type === Meta.WindowClientType.X11
            ? actor.get_first_child()
            : actor;
    }

    /**
     * Create Shadow for rounded corners window
     * @param actor -  window actor which has been setup rounded corners effect
     */
    private _create_shadow(actor: Meta.WindowActor): St.Bin {
        const shadow = new St.Bin({
            name: 'Shadow Actor',
            child: new St.Bin({
                xExpand: true,
                yExpand: true,
            }),
        });
        (shadow.firstChild as St.Bin).add_style_class_name('shadow');

        this._update_shadow_actor_style(
            actor.metaWindow,
            shadow,
            this.global_rounded_corners?.border_radius,
            actor.metaWindow.appears_focused
                ? settings().focused_shadow
                : settings().unfocused_shadow,
        );

        // We have to clip the shadow because of this issues:
        // https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/4474
        shadow.add_effect_with_name(
            constants.CLIP_SHADOW_EFFECT,
            new ClipShadowEffect(),
        );

        // Insert shadow actor below window actor, now shadow actor
        // will show below window actor
        global.windowGroup.insert_child_below(shadow, actor);

        // Bind position and size between window and shadow
        for (let i = 0; i < 4; i++) {
            const constraint = new Clutter.BindConstraint({
                source: actor,
                coordinate: i,
                offset: 0,
            });
            shadow.add_constraint(constraint);
        }

        // Return the shadow we create, it will be store into
        // this.rounded_windows
        return shadow;
    }

    /** Compute outer bound of rounded corners for window actor */
    private _compute_bounds(
        actor: Meta.WindowActor,
        [x, y, width, height]: [number, number, number, number],
    ): types.Bounds {
        const bounds = {
            x1: x + 1,
            y1: y + 1,
            x2: x + actor.width + width,
            y2: y + actor.height + height,
        };

        return bounds;
    }

    private _compute_shadow_actor_offset(
        actor: Meta.WindowActor,
        [offset_x, offset_y, offset_width, offset_height]: [
            number,
            number,
            number,
            number,
        ],
    ): number[] {
        const win = actor.metaWindow;
        const shadow_padding =
            constants.SHADOW_PADDING * UI.WindowScaleFactor(win);

        // If remove UI.scaleFactor(), it should can be works if
        // experimental-features of mutter  'scale-monitor-framebuffer' enabled
        // (Fractional scaling in Wayland)
        // const shadow_padding = constants.SHADOW_PADDING * UI.scaleFactor ()
        return [
            offset_x - shadow_padding,
            offset_y - shadow_padding,
            2 * shadow_padding + offset_width,
            2 * shadow_padding + offset_height,
        ];
    }

    /** Update css style of shadow actor */
    private _update_shadow_actor_style(
        win: Meta.Window,
        actor: St.Bin,
        border_radius_raw = this.global_rounded_corners?.border_radius,
        shadow = settings().focused_shadow,
        padding = this.global_rounded_corners?.padding,
    ) {
        if (!(border_radius_raw && padding)) {
            return;
        }
        const {left, right, top, bottom} = padding;

        // Increasing border_radius when smoothing is on
        let border_radius = border_radius_raw;
        if (this.global_rounded_corners !== null) {
            border_radius *= 1.0 + this.global_rounded_corners.smoothing;
        }

        // Sadly, the scale of style of St.Widget may be different between scale
        // of window if there are two monitor with different scale factor.
        // - Scale of Style always as same as primary monitor
        // - Scale of window as same as the monitor window located.
        //
        // So, we have to adjustment this different

        const original_scale = St.ThemeContext.get_for_stage(
            global.stage as Clutter.Stage,
        ).scaleFactor;
        const win_scale = UI.WindowScaleFactor(win);

        // Now scale factor for shadow actor should be correct.
        const scale_of_style = win_scale / original_scale;

        // _log (JSON.stringify ({ original_scale, win_scale }))

        actor.style = `padding: ${constants.SHADOW_PADDING * scale_of_style}px
        /*background: yellow*/;`;

        const child = actor.firstChild as St.Bin;

        if (
            win.maximizedHorizontally ||
            win.maximizedVertically ||
            win.fullscreen
        ) {
            child.style = 'opacity: 0;';
        } else {
            child.style = `
        background: white;
        border-radius: ${border_radius * scale_of_style}px;
        ${types.box_shadow_css(shadow, scale_of_style)};
        margin: ${top * scale_of_style}px
                ${right * scale_of_style}px
                ${bottom * scale_of_style}px
                ${left * scale_of_style}px;`;
        }

        child.queue_redraw();
    }

    /** Update style for all shadow actors */
    private _update_all_shadow_actor_style() {
        for (const actor of global.get_window_actors()) {
            const info = (actor as ExtensionsWindowActor)
                .__rwc_rounded_window_info;
            if (!info) {
                continue;
            }
            const {shadow} = info;
            const win = actor.meta_window;
            const shadow_cfg = actor.metaWindow.appears_focused
                ? settings().focused_shadow
                : settings().unfocused_shadow;
            const {border_radius, padding} = this._get_rounded_corners_cfg();

            this._update_shadow_actor_style(
                win,
                shadow,
                border_radius,
                shadow_cfg,
                padding,
            );
        }
    }

    private _get_rounded_corners_cfg(): types.RoundedCornersCfg {
        return this.global_rounded_corners ?? settings().global_rounded_corner_settings;
    }

    /**
     * This method will be called when global rounded corners settings changed.
     */
    private _update_all_rounded_corners_settings() {
        this.global_rounded_corners = settings().global_rounded_corner_settings;

        for (const actor of global.get_window_actors()) {
            const info = (actor as ExtensionsWindowActor)
                .__rwc_rounded_window_info;
            if (!info) {
                continue;
            }
            this.on_size_changed(actor);
        }

        this._update_all_shadow_actor_style();
    }
}
