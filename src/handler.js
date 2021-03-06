import xhr from 'xhr';
import {version} from '../package.json';

/**
 * Handler for the creation of a payment token using the Rebilly API. Partially exposed by the main Rebilly factory.
 */
export default class Handler {
    attrKey = 'data-rebilly';
    endpoint = null;
    authorization = null;
    publishableKey = null;
    modules = [];

    constructor({modules, endpoint}) {
        this.modules = modules;
        this.endpoint = endpoint;
    }

    /**
     * Process all existing modules and reduce their results into a single object literal.
     * @returns {Promise.<*>}
     */
    async processModules() {
        const promises = this.modules.map(module => module());
        const results = await Promise.all(promises);
        return results.reduce((result, value) => {
            result = {...result, ...value};
            return result;
        }, {});
    }

    /**
     * Combine the token data with the module payloads while allowing
     * some keys to be overwritten (e.g. lead source).
     * @param data
     * @returns {Object}
     */
    async combineData(data) {
        const moduleData = await this.processModules();
        if (data.leadSource) {
            // allow overwriting of leadSource
            delete moduleData.leadSource;
        }
        return {
            ...data,
            ...moduleData,
        };
    }

    /**
     * Overwrite the default endpoint URL with another value.
     * @param url {string}
     */
    setEndpoint(url = null) {
        this.endpoint = url;
    }

    /**
     * Set the authorization value to authenticate the API request used to generate the payment token.
     * @param signature {string|null}
     */
    setAuth(signature = null) {
        this.authorization = signature;
    }

    /**
     * Set to use a publishable key instead of the previous method of `authorization`.
     * Publishable keys are a type of API key that can be created in Rebilly to allow payment token related
     * actions.
     * @since 1.2.0
     * @param key {string}
     */
    setPublishableKey(key = null) {
        this.publishableKey = key;
    }

    /**
     * Create the token and return its value via the callback provided.
     * @param payload {Object|Node}
     * @param callback {Function}
     * @param extraData {Object?}
     * @returns {Promise.<void>|boolean}
     */
    async createToken(payload, callback, extraData = {}) {
        if (this.authorization === null && this.publishableKey === null) {
            console.error('Missing Rebilly authentication value');
            return false;
        }
        let data = {};
        const isForm = (() => {
            try {
                return payload instanceof HTMLElement;
            }
            catch (err) {
                return false;
            }
        })();
        // check whether we are handling a form node or an
        // object literal
        if (!isForm) {
            data = {...payload};
        }
        else {
            data = this.serializeForm(payload);
        }
        data = await this.combineData({...data, ...extraData});
        // convert legacy method values if present
        if (data.method) {
            this.convertLegacyMethods(data);
        }
        // or detect the method when not defined
        else if (data.paymentInstrument) {
            this.detectMethod(data);
        }
        else {
            console.error('Missing method and payment instrument data');
            return false;
        }
        xhr(this.getConfig(data), this.handleResponse(callback));
    }

    /**
     * Serialize the content of the form's Rebilly fields into an object literal.
     * @param form {Node}
     * @returns {Object}
     */
    serializeForm(form) {
        const instrumentFields = [
            // payment card
            'pan', 'expMonth', 'expYear', 'cvv',
            // ach
            'routingNumber', 'accountNumber', 'accountType',
        ];
        const fields = this.getFormFields(form);
        const paymentInstrument = {};
        const billingAddress = {};
        const getValue = (field) => {
            if (field.tagName.toLowerCase() === 'select') {
                return field.options[field.selectedIndex].value;
            }
            return field.value;
        };
        fields.forEach(field => {
            if (field.hasAttribute(this.attrKey)) {
                const prop = field.getAttribute(this.attrKey);
                if (prop !== null && prop !== '') {
                    const value = String(getValue(field)).replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '');
                    if (value !== '') {
                        if (instrumentFields.indexOf(prop) > -1) {
                            paymentInstrument[prop] = value;
                        }
                        else {
                            billingAddress[prop] = value;
                        }
                    }
                }
            }
        });

        // if the payload objects are empty return null
        return {
            paymentInstrument: Object.keys(paymentInstrument).length ? paymentInstrument : null,
            billingAddress: Object.keys(billingAddress).length ? billingAddress : null,
        };
    }

    /**
     * Return an enumerable list of form elements that could contain field data.
     * @param form {Node}
     * @returns {Array}
     */
    getFormFields(form) {
        return [
            ...Array.from(form.getElementsByTagName('input')),
            ...Array.from(form.getElementsByTagName('select')),
        ];
    }

    /**
     * Generate the configuration data required for the XHR request.
     * @param data {Object}
     * @returns {Object}
     */
    getConfig(data) {
        const config = {
            method: 'post',
            body: data,
            uri: this.endpoint,
            json: true,
            headers: {
                'reb-api-consumer': `RebillySDK/JS-Token ${version}`,
            },
        };
        if (this.publishableKey !== null) {
            config.headers['Authorization'] = `Bearer ${this.publishableKey}`;
        } else {
            config.headers['reb-auth'] = this.authorization;
        }
        return config;
    }

    /**
     * Handle the response of the XHR request.
     * @param callback {Function}
     * @returns {Object}
     */
    handleResponse(callback) {
        return (error, response, body) => {
            const params = {
                xhr: response.rawRequest,
                status: response.statusCode,
                error: false,
                data: null,
                message: 'success',
            };
            // error prior to running the XHR request
            if (error) {
                params.error = true;
                params.message = error.message;
            }
            else {
                params.data = body;
                // check if the status code indicates an error
                if (response.statusCode !== 201) {
                    params.error = true;
                    params.message = params.data.error;
                }
            }
            callback(params);
        };
    }

    /**
     * Convert legacy payment method values to their current equivalents.
     * @param data {Object}
     */
    convertLegacyMethods(data) {
        const map = {
            'payment_card': 'payment-card',
            'bank_account': 'ach',
        };
        Object.keys(map).forEach(key => {
            if (data.method === key) {
                data.method = map[key];
            }
        });
    }

    /**
     * Detect the payment method when missing from the data payload.
     * @param data {Object}
     */
    detectMethod(data) {
        const map = {
            'payment-card': ['pan', 'expMonth', 'expYear', 'cvv'],
            'ach': ['routingNumber', 'accountNumber', 'accountType'],
        };
        const fields = Object.keys(data.paymentInstrument);
        Object.keys(map).forEach(method => {
            const match = fields.some(field => map[method].indexOf(field) > -1);
            if (match && !data.method) {
                data.method = method;
                console.log(`Rebilly detected "${method}" as the payment method`);
            }
        });
    }
}
