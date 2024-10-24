import getExposedPromise from 'get-exposed-promise';
import Collection from "b24-sdk/Collection";

export default {
    /**
     * @param {string} method
     * @param {Object} data
     * @param {BX24WrapperFetchOptions} options
     * @returns {Promise<*[]|{entries: *[], total: number}>}
     *
     * @typedef {Object} BX24WrapperFetchOptions
     * @property {boolean} total If true, method will return {entries, total} object
     */
    fetch: async function (method, data = {}, options = {}) {
        let result;

        try {
            result = await (() => {
                const {promise, resolve, reject} = getExposedPromise();

                BX24.callMethod(method, data, (result) => {
                    if (result.error()) {
                        console.error('error', result.error());
                        console.log(result);

                        let error = result.error();
                        alert(error.ex.error_description + `(${error.ex.error})`);
                        throw new Error('BX24 Error: ' + error.ex.error_description);
                        //reject(result);
                    } else {
                        let resultItems;
                        
                        if (options.getter) {
                            // Some methods return items in subkey like "orders" or "productItems"
                            resultItems = options.getter(result.data());
                        } else {
                            resultItems = result.data();
                        }
                        
                        resolve({
                            entries: resultItems,
                            total: result.total(),
                        });
                    }
                });

                return promise;
            })();
        } catch (ex) {
            let error = result.error();
            console.error(error);
            alert(error.error_description + `(${error.error})`);
            throw new Error('BX24 Error: ' + error.error_description);
        }

        let returnResult;

        if (options.total) {
            returnResult = {
                entries: result.entries,
                total: result.total,
            };
        } else {
            returnResult = result.entries;
        }

        return returnResult;
    },

    /**
     * @param {string} method
     * @param {Object|Array|string} data
     * @param {BX24WrapperFetchAllOptions} options
     * @returns {Promise<*[]|{entries: *[], total: number}>}
     *
     * @typedef {Object} BX24WrapperFetchAllOptions
     * @property {boolean} total If true, method will return {entries, total} object
     */
    fetchAll: async function (method, data = {}, options = {}) {
        const pageSize = 50;
        const batchLimit = 50;
        let limit = options.limit || null;

        const firstResponse = await this.callRaw(method, data);
        let entries;

        if (options.getter) {
            // Some methods return items in subkey like "orders" or "productItems"
            entries = options.getter(firstResponse.data());
        } else {
            entries = firstResponse.data();
        }
        
        
        const totalEntries = firstResponse.total();

        if (firstResponse.more()) {
            let totalToObtain;

            // Restrict amount of entries manually if a limit is passed
            if (limit) {
                totalToObtain = Math.min(totalEntries, limit);
            } else {
                totalToObtain = totalEntries;
            }

            const totalCalls = Math.ceil(totalToObtain / pageSize);
            let batchCalls = [];

            // We already got first 50 entries, skip first page
            for (let i = 1; i < totalCalls; i++) {
                batchCalls.push([
                    method, {
                        ...data,
                        start: i * pageSize,
                    }
                ]);
            }
            
            const batchCallsChunksCount = Math.ceil(batchCalls.length / batchLimit);

            for (let i = 0; i < batchCallsChunksCount; i++) {
                let batchChunk = batchCalls.slice(i * batchLimit, (i + 1) * batchLimit);
                let batchResults = await this.batch(batchChunk);

                for (let result of batchResults) {
                    if (result.error()) {
                        console.error(result);
                        throw new Error('Error on batch fetch. ' + result.error());
                    }

                    let resultItems;

                    if (options.getter) {
                        // Some methods return items in subkey like "orders" or "productItems"
                        resultItems = options.getter(result.data());
                    } else {
                        resultItems = result.data();
                    }
                    
                    entries = entries.concat(resultItems);
                }

                if (limit !== null && entries.length >= limit) {
                    entries = entries.slice(0, limit);
                    break;
                }
            }
        }

        let returnResult;

        if (options.total) {
            returnResult = {
                total: totalEntries,
                entries: entries,
            };
        } else {
            returnResult = entries;
        }

        return returnResult;
    },

    /**
     * Method disables using page navigation via api and obtains
     * all of items ordered by primary key.
     * Make sense to use this method for queries with large amount of entries.
     * 
     * @param {string} method
     * @param {Object|Array|string} data
     * @param {BX24WrapperFastFetchAllOptions} options
     * @returns {Promise<*[]|{entries: *[], total: number}>}
     * 
     * @typedef {Object} BX24WrapperFastFetchAllOptions
     * @property {boolean} total If true, method will return {entries, total} object
     * @property {primaryKey} Primary key of entity to order and filter items
     * @property {filterKey} Key in `data` which contains filter
     */
    fastFetchAll: async function (method, data = {}, options = {}) {
        let primaryKey = options.primaryKey || 'ID';
        // If no key, try to guess it
        let filterKey = options.filterKey || (data.FILTER ? 'FILTER' : 'filter');
        let limit = options.limit || null;
        
        let isMore = true;
        let lastId = 0;
        let entries = [];
        let modifiedOptions = {...options};
        delete modifiedOptions.total;

        do {
            let modifiedData = {
                ...data,
                [filterKey]: {
                    ...data[filterKey],
                    ['>' + primaryKey]: lastId,
                },
                start: -1,
            };
            
            let result = await this.fetch(method, modifiedData, modifiedOptions);
            entries = entries.concat(result);
            
            if (limit !== null && entries.length >= limit) {
                entries = entries.slice(0, limit);
                break;
            }

            if (result.length < 50) {
                break;
            } else {
                lastId = entries[entries.length - 1][primaryKey];
            }
        } while (true);

        let returnResult;
        
        if (options.total) {
            returnResult = {
                total: entries.length,
                entries: entries,
            };
        } else {
            returnResult = entries;
        }
        
        return returnResult;
    },

    batch: function (calls) {
        const {promise, resolve, reject} = getExposedPromise();

        if (Array.isArray(calls) && calls.length === 0 || calls.constructor === Object && Object.keys(calls).length === 0) {
            resolve();
            return promise;
        }

        BX24.callBatch(calls, (result) => {
            resolve(result);
        });

        return promise;
    },

    /**
     * Returns full response object
     *
     * @param method
     * @param params
     * @returns {Promise}
     */
    callRaw: function (method, params) {
        const {promise, resolve, reject} = getExposedPromise();

        BX24.callMethod(method, params, (result) => {
            if (result.error()) {
                console.error(result.error());
                console.log(result);
                reject(result);
            } else {
                resolve(result);
            }
        });

        return promise;
    },

    callBind: function (event, handler, authId = null) {
        const {promise, resolve, reject} = getExposedPromise();

        BX24.callBind(event, handler, authId, (result) => {
            if (result.error()) {
                console.error(result.error());
                console.log(result);
                reject(result);
            } else {
                resolve(result.data());
            }
        });

        return promise;
    },

    callUnbind: function (event, handler, authId = null) {
        const {promise, resolve, reject} = getExposedPromise();

        BX24.callUnbind(event, handler, authId, (result) => {
            if (result.error()) {
                console.error(result.error());
                console.log(result);
                reject(result);
            } else {
                resolve(result.data());
            }
        });

        return promise;
    },
};
