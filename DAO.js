var sqlite3 = require('sqlite3');
var Promise = require('bluebird');

// I'm following along with 
// https://stackabuse.com/a-sqlite-tutorial-with-node-js/

class DAO {
    constructor(path) {
        this.db = new sqlite3.Database(path);
    }

    generatePromise(func, sql, args) {
        return new Promise((resolve, reject) => {
            func((err, result) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(result);
                }
            });
        });
    }

    get(sql, args) {
        return this.generatePromise((resultHandler) => this.db.get(sql, args, resultHandler));
    }

    all(sql, args) {
        return this.generatePromise((resultHandler) => this.db.all(sql, args, resultHandler));
    }

    run(sql, args) {
        return this.generatePromise((resultHandler) => this.db.run(sql, args, resultHandler));
    }

}

module.exports = DAO;