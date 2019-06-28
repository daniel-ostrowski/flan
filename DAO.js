var sqlite3 = require('sqlite3');
var Promise = require('bluebird');

// I'm following along with 
// https://stackabuse.com/a-sqlite-tutorial-with-node-js/

class DAO {
    constructor(path) {
        this.db = new sqlite3.Database(path);
    }

    get(sql, args) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, args, (err, result) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(result);
                }
            });
        });
    }
}

module.exports = DAO;