// imports.gi
import type Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';
import type Meta from 'gi://Meta';
import type Shell from 'gi://Shell';

// local modules
import {RoundedCornersManager} from '../manager/rounded_corners_manager.js';
import {Connections} from '../utils/connections.js';
import {_log} from '../utils/log.js';
import {settings} from '../utils/settings.js';

// types, those import statements will be removed in output javascript files.
import type Gio from 'gi://Gio';
import type {SchemasKeys} from '../utils/settings.js';
import type {EffectManager} from '../utils/types.js';
import type {ExtensionsWindowActor} from '../utils/types.js';
import {shell_version} from '../utils/ui.js';

// --------------------------------------------------------------- [end imports]

export class WindowActorTracker {
    private effect_managers: EffectManager[] = [];

    /**
     * connections store connect handles of GObject, so that we can call
     * disconnect_all() to disconnect all signals when extension disabled
     */
    private connections: Connections | null = null;

    // ---------------------------------------------------------- [public methods]

    private run(exec: (m: EffectManager) => void) {
        for (const m of this.effect_managers) {
            exec(m);
        }
    }

    /** Call When enable extension */
    enable() {
        this.connections = new Connections();
        this.effect_managers = [new RoundedCornersManager()];

        // watch settings
        this.connections.connect(
            settings().g_settings,
            'changed',
            (_: Gio.Settings, key: string) =>
                this.run(m => m.on_settings_changed(key as SchemasKeys)),
        );

        const wm = global.windowManager;

        // Add effects to all windows when extensions enabled
        const window_actors = global.get_window_actors();
        _log(`Windows count when enable: ${window_actors.length}`);
        for (const actor of window_actors) {
            this._add_effect(actor);
        }

        // Add effects when window opened
        this.connections.connect(
            global.display,
            'window-created',
            (_: Meta.Display, win: Meta.Window) => {
                const actor: Meta.WindowActor =
                    win.get_compositor_private() as Meta.WindowActor;

                // If wm_class_instance of Meta.Window is null, try to add rounded
                // corners when wm_class_instance is set
                if (win?.get_wm_class_instance() == null) {
                    const notify_id = win.connect('notify::wm-class', () => {
                        this._add_effect(actor);
                        win.disconnect(notify_id);
                    });
                } else {
                    this._add_effect(actor);
                }
            },
        );

        this.connections.connect(
            wm,
            'switch-workspace',
            (_: Shell.WM, from: number, to: number) => {
                this.run(m => {
                    const ws =
                        global.workspaceManager.get_workspace_by_index(to);
                    if (!m.on_switch_workspace) {
                        return;
                    }
                    for (const win of ws?.list_windows() ?? []) {
                        m.on_switch_workspace(
                            win.get_compositor_private() as Meta.WindowActor,
                        );
                    }
                });
                _log(`Change WorkSpace ${from} -> ${to}`);
            },
        );

        // Connect 'minimized' signal
        this.connections.connect(
            wm,
            'minimize',
            (_: Shell.WM, actor: Meta.WindowActor) => {
                this.run(m => m.on_minimize(actor));
            },
        );

        // Restore visible of shadow when un-minimized
        this.connections.connect(
            wm,
            'unminimize',
            (_: Shell.WM, actor: Meta.WindowActor) => {
                // Handle visible of shader with Compiz alike magic lamp effect
                // After MagicLampUnminimizeEffect completed, then show shadow
                //
                // https://github.com/hermes83/compiz-alike-magic-lamp-effect
                const effect = actor.get_effect('unminimize-magic-lamp-effect');
                if (effect) {
                    type Effect = Clutter.Effect & {timerId: Clutter.Timeline};
                    const timer_id = (effect as Effect).timerId;

                    const id = timer_id.connect('new-frame', source => {
                        // Effect completed when get_process() touch 1.0
                        // Need show shadow here
                        if (source.get_progress() > 0.98) {
                            _log('Handle Unminimize with Magic Lamp Effect');

                            this.run(m => m.on_unminimize(actor));
                            source.disconnect(id);
                        }
                    });
                    return;
                }

                this.run(m => m.on_unminimize(actor));
            },
        );

        // Disconnect all signals of window when closed
        this.connections.connect(
            wm,
            'destroy',
            (_: Shell.WM, actor: Meta.WindowActor) =>
                this._remove_effect(actor),
        );

        // When windows restacked, change order of shadow actor too
        this.connections.connect(global.display, 'restacked', () => {
            for (const actor of global.get_window_actors()) {
                if (!actor.visible) {
                    continue;
                }
                this.run(m => m.on_restacked(actor));
            }
        });
    }

    /** Call when extension is disabled */
    disable() {
        // Remove rounded effect and shadow actor for all windows
        for (const actor of global.get_window_actors()) {
            this._remove_effect(actor);
        }

        // Disconnect all signal
        this.connections?.disconnect_all();
        this.connections = null;
    }

    // ------------------------------------------------------- [private methods]
    /**
     * Add rounded corners effect and setup shadow actor for a window actor
     * @param actor - window to add effect
     */
    private _add_effect(actor: ExtensionsWindowActor) {
        const actor_is_ready = () => {
            if (!this.connections) {
                return;
            }

            const texture = actor.get_texture();
            if (!texture) {
                return;
            }

            this.connections.connect(texture, 'size-changed', () => {
                this.run(m => m.on_size_changed(actor));
            });

            actor.__rwc_last_size = Graphene.Size.zero();
            this.connections.connect(actor, 'notify::size', () => {
                const last_size = actor.__rwc_last_size as Graphene.Size;
                if (!last_size.equal(actor.size)) {
                    last_size.width = actor.size.width;
                    last_size.height = actor.size.height;

                    this.run(m => m.on_size_changed(actor));
                }
            });

            if (shell_version() >= 43.1) {
                // let's update effects when surface size of window actor changed in the
                // first time. After Gnome 43.1, we need do this to make sure effects
                // works when wayland client opened.
                const id = actor.firstChild.connect('notify::size', () => {
                    this.run(m => m.on_size_changed(actor));
                    // Now updated, just disconnect it
                    actor.firstChild.disconnect(id);
                });
            }

            // Update shadow actor when focus of window has changed.
            this.connections.connect(
                actor.metaWindow,
                'notify::appears-focused',
                () => {
                    this.run(m => m.on_focus_changed(actor));
                },
            );

            // When window is switch between different monitor,
            // 'workspace-changed' signal emit.
            this.connections.connect(
                actor.metaWindow,
                'workspace-changed',
                () => {
                    this.run(m => m.on_focus_changed(actor));
                },
            );

            // Update shadows and rounded corners bounds
            this.run(m => {
                m.on_add_effect(actor);
                m.on_size_changed(actor);
                m.on_focus_changed(actor);
            });
        };

        if (actor.firstChild) {
            actor_is_ready();
        } else {
            // In wayland session, Surface Actor of XWayland client not ready when
            // window created, waiting it
            const id = actor.connect('notify::first-child', () => {
                // now it's ready
                actor_is_ready();
                actor.disconnect(id);
            });
        }
    }

    private _remove_effect(actor: ExtensionsWindowActor) {
        delete actor.__rwc_last_size;

        const texture = actor.get_texture();
        if (this.connections && texture) {
            this.connections.disconnect_all(texture);
            this.connections.disconnect_all(actor);
            this.connections.disconnect_all(actor.metaWindow);
            this.connections.disconnect_all(actor.firstChild);
        }
        this.run(m => m.on_remove_effect(actor));
    }
}
