class PostRepository {
    constructor(dao) {
        this.dao = dao;
    }

    getByID(id) {
        return this.dao.get(`SELECT * FROM Posts WHERE ID = ?`, [id]);
    }
}

module.exports = PostRepository;