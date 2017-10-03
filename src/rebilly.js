import Handler from './handler';

/**
 * Generate a payment token creation handler with a set of modules
 * @param modules {Function[]} A list of modules to run when creating the token. Each module must return an object literal.
 * @returns {Object}
 * @constructor
 */
export default function Rebilly({modules = []} = {}) {
    const config = {modules, endpoint: 'https://api.rebilly.com/v2.1/tokens'};
    const handler = new Handler(config);

    return {
        setEndpoint: handler.setEndpoint,
        setAuth: handler.setEndpoint,
        createToken: handler.setEndpoint
    };
}
