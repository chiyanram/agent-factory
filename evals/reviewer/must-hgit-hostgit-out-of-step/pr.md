# fix(git): hostGit never signs, so no gpg program runs (#999)

A repo that sets commit.gpgsign made hostGit run gpg on the host. hostGit now always sets commit.gpgsign and
tag.gpgsign to false.
