class NamedBlobRepository {
    constructor(dao) {
        this.dao = dao;
    }

    getByID(id) {
        return this.dao.get(`SELECT * FROM NamedBlobs WHERE ID = ?`, [id]);
    }
}

module.exports = NamedBlobRepository;