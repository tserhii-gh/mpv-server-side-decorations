// Types
import type GObject from 'gi://GObject';

// ---------------------------------------------------------------- [end import]

/**
 * This class is used to manager signal and handles of a object
 */
export class Connections {
    // -------------------------------------------------------- [public methods]

    /**
     * Map object to store signal sources and their handlers
     * @type {Map<GObject.Object, { [signal_name: string]: number }>}
     */
    private connections: _Map = new Map();

    /**
     * Handler signal for a GObject
     *
     * ### Example:
     *
     * ```typescript
     * const manager = new Connections ()
     * manager.connect (global.window_manager, 'destroy', (wm, actor) =>
     *     console.log (`${actor} has been removed`)
     * )
     * ```
     * @param source - Signal source
     * @param args - Arguments pass into GObject.Object.connect()
     *
     * biome-ignore lint/suspicious/noExplicitAny: this will make life easier
     */
    connect<T extends GObject.Object>(source: T, ...args: any): void {
        const signal: string = args[0];
        const id: number = source.connect(args[0], args[1]);

        // Source has been added into manager
        {
            const handlers = this.connections.get(source);
            if (handlers !== undefined) {
                if (handlers[signal] !== undefined) {
                    handlers[signal].push(id);
                    return;
                }
                handlers[signal] = [id];
                return;
            }
        }

        // Source is first time register signal
        const handlers: {[signal: string]: number[]} = {};
        handlers[signal] = [id];
        this.connections.set(source, handlers);
    }

    disconnect<T extends GObject.Object>(
        source: T,
        signal: Parameters<T['connect']>[0],
    ): void;
    disconnect(source: GObject.Object, signal: string): void;
    /** Disconnect signal for source */
    disconnect<T extends GObject.Object>(
        source: T,
        signal: Parameters<T['connect']>[0],
    ) {
        const handlers = this.connections.get(source);
        if (handlers !== undefined) {
            const handler = handlers[signal];
            if (handler !== undefined) {
                for (const id of handler) {
                    source.disconnect(id);
                }
                delete handlers[signal];
                if (Object.keys(handler).length === 0) {
                    this.connections.delete(source);
                }
                return;
            }
        }
    }

    /** Disconnect **all** signals for object */
    disconnect_all(source: GObject.Object): void;

    /** Disconnect **all** signals for **all** objects */
    disconnect_all(): void;

    disconnect_all(source?: GObject.Object) {
        // If provide source,  disconnect all signal of it
        if (source !== undefined) {
            const handlers = this.connections.get(source);
            if (handlers !== undefined) {
                for (const signal in handlers) {
                    for (const id of handlers[signal]) {
                        source.disconnect(id);
                    }
                    delete handlers[signal];
                }
                this.connections.delete(source);
            }
            return;
        }

        // otherwise clear signal for all objects.
        this.connections.forEach((handlers, source) => {
            for (const signal in handlers) {
                for (const id of handlers[signal]) {
                    source.disconnect(id);
                }
                delete handlers[signal];
            }
        });
        this.connections.clear();
    }
}

/** A singleton of connections */
let _connections: Connections | null = null;

export const connections = {
    get: () => {
        if (_connections === null) {
            _connections = new Connections();
        }
        return _connections;
    },
    del: () => {
        _connections = null;
    },
};

//              Signal source     signal name            it's handler
type _Map = Map<GObject.Object, {[signal_name: string]: number[]}>;
