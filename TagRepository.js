class TagRepository {
    constructor(dao) {
        this.dao = dao;
    }

    getByID(id) {
        return this.dao.get(`SELECT * FROM Tags WHERE ID = ?`, [ID]);
    }
}

module.exports = TagRepository;