-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_acceptedUserId_fkey" FOREIGN KEY ("acceptedUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
