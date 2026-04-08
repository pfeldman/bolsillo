require 'xcodeproj'

team_id = ENV['APPLE_TEAM_ID']
pp_uuid = ENV['PP_UUID']

project = Xcodeproj::Project.open('ios/App/App.xcodeproj')
target = project.targets.find { |t| t.name == 'App' }

target.build_configurations.each do |config|
  config.build_settings['CODE_SIGN_STYLE'] = 'Manual'
  config.build_settings['CODE_SIGN_IDENTITY'] = 'Apple Distribution'
  config.build_settings['DEVELOPMENT_TEAM'] = team_id
  config.build_settings['PROVISIONING_PROFILE'] = pp_uuid
  config.build_settings['PROVISIONING_PROFILE_SPECIFIER'] = ''
end

project.save
puts "Signing configured for App target: team=#{team_id}, profile=#{pp_uuid}"
