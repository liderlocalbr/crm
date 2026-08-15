# Achados da auditoria Google Agenda

A documentação oficial do Supabase sobre Login com Google informa que os tokens da sessão do Supabase são diferentes dos tokens OAuth do Google. Para acessar APIs Google, a aplicação precisa capturar e armazenar o `provider_token` retornado na sessão; para obter `provider_refresh_token`, deve solicitar `access_type=offline` e `prompt=consent`. A documentação também recomenda configurar os escopos adicionais na configuração de Data Access (Scopes) do provedor Google no Supabase.

A documentação oficial de Identity Linking informa que o Supabase vincula identidades Google ao usuário e que uma identidade já vinculada não deve ser vinculada novamente. Portanto, o log `422: Identity is already linked` confirma que o vínculo existe, mas não prova que o token OAuth de Calendar esteja presente nesta sessão ou que o escopo `https://www.googleapis.com/auth/calendar.events` tenha sido concedido.

Fontes consultadas:
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/auth/auth-identity-linking
